// kit/tour.js - guided tour with a visible fake cursor. Started and paused by the visitor (Tour button); any real input pauses it in place.
//
// A script is an array of steps. Each step is an object; the runner executes its keys in this order:
//   reset:true | resetView:true | resetModel:true
//   mode:'solid'|'cutaway'|'xray'      cursor clicks the mode button
//   cut:<deg>                          sets cutaway angle
//   camera:'iso'|'front'|'side'|'top'|{az,el}
//   isolate:'<partId>'                 cursor clicks that part's button      | clear:true clears the isolate
//   explode:<0..1>                     cursor drags the explode slider (takes `ms`, default 1600)
//   control:{id,to}  (id of a control, `to` in the control's display units)  cursor drags the slider (takes `ms`)
//   press:'<controlId>'                cursor clicks a button control (e.g. 'scram')
//   accel:<1|10|100|1000>              cursor clicks the time-acceleration button
//   say:'caption text'                 shown in the caption bar for the duration of the step
//   wait:<ms>                          pause after the step (default 600; `hold` is an alias)
import { clamp, easeInOut } from './util.js';
import { t } from './i18n.js';

export class Tour {
  /** The tour only runs because the visitor pressed the Tour button: no auto-start, no idle hand-back. */
  constructor({ api, cursor, caption, reduced = false }) {
    this.api = api;
    this.cursor = cursor;
    this.caption = caption;
    this.reduced = reduced;
    this.script = [];
    this.running = false;
    this.token = 0;
    this.idx = 0; // next step to run; pause keeps it, the end of the script rewinds it
    this.cx = innerWidth * 0.5;
    this.cy = innerHeight * 0.6;
    this.onState = null;
  }
  setScript(steps) {
    this.script = steps || [];
    this.idx = 0;
  }
  /** Any real user input while the tour runs pauses it in place. */
  input() {
    if (this.running) this.pause();
  }
  _notify(on, ended = false) {
    this.api.tourState && this.api.tourState(on, ended);
    this.onState && this.onState(on, ended);
  }
  /** Pause in place: the step that was running is replayed from its start when the tour resumes. */
  pause() {
    if (!this.running) return;
    this.token++;
    this.running = false;
    this.cursor.classList.remove('on', 'click');
    this._setCaption('');
    this._notify(false);
  }
  /** Stop and rewind to step 1 (machine switch). */
  reset() {
    this.token++;
    const was = this.running;
    this.running = false;
    this.idx = 0;
    this.cursor.classList.remove('on', 'click');
    this._setCaption('');
    if (was) this._notify(false);
  }
  async start() {
    if (!this.script.length || this.running) return;
    if (this.idx >= this.script.length) this.idx = 0;
    const token = ++this.token;
    this.running = true;
    this._notify(true);
    if (this.idx === 0) {
      this.api.resetAll();
      this._move(innerWidth * 0.55, innerHeight * 0.55, true);
    }
    this.cursor.classList.add('on');
    try {
      while (this.idx < this.script.length) {
        if (token !== this.token) return;
        await this._run(this.script[this.idx], token);
        this.idx++;
      }
      await this._sleep(1500, token);
      if (token === this.token) {
        this.running = false;
        this.idx = 0;
        this.cursor.classList.remove('on', 'click');
        this._setCaption('');
        this._notify(false, true);
      }
    } catch (e) {
      if (e !== 'cancel') throw e;
    }
  }
  _setCaption(txt) {
    this._lastSay = txt;
    if (!this.caption) return;
    this.caption.textContent = t(txt);
    this.caption.classList.toggle('on', !!txt);
  }
  _sleep(ms, token) {
    return new Promise((res, rej) => {
      const t0 = performance.now();
      const tick = () => {
        if (token !== this.token) return rej('cancel');
        if (performance.now() - t0 >= ms) return res();
        setTimeout(tick, Math.min(60, ms));
      };
      tick();
    });
  }
  _move(x, y, instant) {
    this.cx = x;
    this.cy = y;
    this.cursor.style.transition = instant ? 'none' : '';
    this.cursor.style.transform = `translate(${x}px, ${y}px)`;
  }
  async _to(el, token, dx = 0.5, dy = 0.5) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    this._move(r.left + r.width * dx, r.top + r.height * dy);
    await this._sleep(720, token);
  }
  async _click(token) {
    this.cursor.classList.add('click');
    await this._sleep(160, token);
    this.cursor.classList.remove('click');
  }
  async _anim(ms, token, fn) {
    const t0 = performance.now();
    await new Promise((res, rej) => {
      const f = () => {
        if (token !== this.token) return rej('cancel');
        const k = clamp((performance.now() - t0) / ms, 0, 1);
        fn(easeInOut(k));
        if (k >= 1) return res();
        requestAnimationFrame(f);
      };
      f();
    });
  }
  async _run(s, token) {
    const api = this.api;
    const q = (sel) => document.querySelector(sel);
    if (s.say !== undefined) this._setCaption(s.say);
    if (s.reset) api.resetAll();
    if (s.resetView) api.resetView();
    if (s.resetModel) api.resetModel();
    if (s.mode) {
      await this._to(q(`[data-tour="mode:${s.mode}"]`), token);
      await this._click(token);
      api.setMode(s.mode);
    }
    if (s.cut !== undefined) {
      const el = q('[data-tour="cut"]');
      await this._to(el, token);
      api.setCut(s.cut);
    }
    if (s.camera) {
      const name = typeof s.camera === 'string' ? s.camera : null;
      if (name) {
        await this._to(q(`[data-tour="cam:${name}"]`), token);
        await this._click(token);
      }
      api.camera(s.camera);
    }
    if (s.isolate) {
      const el = q(`[data-tour="part:${s.isolate}"]`);
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      await this._to(el, token, 0.3);
      await this._click(token);
      api.isolate(s.isolate);
    }
    if (s.clear) {
      await this._to(q('[data-tour="clear"]'), token);
      await this._click(token);
      api.isolate(null);
    }
    if (s.explode !== undefined) {
      const el = q('[data-tour="explode"] input');
      const from = api.getExplode();
      const ms = s.ms ?? 1600;
      await this._to(el, token, from, 0.5);
      await this._anim(ms, token, (k) => {
        const v = from + (s.explode - from) * k;
        api.setExplode(v);
        const r = el.getBoundingClientRect();
        this._move(r.left + r.width * (0.03 + 0.94 * v), r.top + r.height / 2, true);
      });
    }
    if (s.control) {
      const { id, to } = s.control;
      const wrap = q(`[data-tour="ctl:${id}"]`);
      const inp = wrap && wrap.querySelector('input');
      const from = api.getControl(id);
      const ms = s.ms ?? 2200;
      const min = inp ? Number(inp.min) : 0;
      const max = inp ? Number(inp.max) : 1;
      const fx = (v) => (v - min) / (max - min);
      await this._to(inp, token, fx(from), 0.5);
      await this._anim(ms, token, (k) => {
        const v = from + (to - from) * k;
        api.setControl(id, v);
        if (inp) {
          const r = inp.getBoundingClientRect();
          this._move(r.left + r.width * (0.03 + 0.94 * fx(v)), r.top + r.height / 2, true);
        }
      });
    }
    if (s.press) {
      await this._to(q(`[data-tour="ctl:${s.press}"]`), token);
      await this._click(token);
      api.press(s.press);
    }
    if (s.accel !== undefined) {
      await this._to(q(`[data-tour="accel"] [data-v="${s.accel}"]`), token);
      await this._click(token);
      api.setAccel(s.accel);
    }
    await this._sleep(s.wait ?? s.hold ?? (s.say ? 2200 : 500), token);
  }
}

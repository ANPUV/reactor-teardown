// MSR tour (about 80 s). Step vocabulary is documented in kit/tour.js.
export const tour = [
  { say: 'A molten-salt breeder: the fuel is a liquid, dissolved in the coolant and moving through the whole plant.', wait: 3400 },
  { camera: 'iso', say: 'About 700 °C at near-atmospheric pressure. The same salt makes the heat and carries it away.', wait: 3000 },
  { isolate: 'core', say: 'Graphite slows the neutrons. Salt flows up through channels between 1412 graphite elements.', wait: 3200 },
  { isolate: 'element', say: 'One element, enlarged: the glowing salt runs in the gaps between graphite blocks.', wait: 2800 },
  { isolate: 'chem', say: 'Thorium cannot fission. It captures a neutron and becomes Pa-233, then U-233 after 27 days. This plant holds Pa-233 aside so it decays instead of absorbing neutrons.', wait: 4600 },
  { isolate: 'offgas', say: 'Helium bubbles strip xenon-135 from the salt. The poison that stalls a water reactor barely builds up.', wait: 3000 },
  { clear: true, mode: 'cutaway', say: 'The whole plant again. Salt, heat exchangers, steam, turbine, cooling tower.', wait: 1800 },
  { accel: 10, control: { id: 'load', to: 55 }, ms: 1800, say: 'Ask the turbine for less. The rods stay where they are.', wait: 3000 },
  { say: 'Hotter salt is less reactive (about −3.3 pcm per kelvin), so power follows the load by itself.', wait: 3400 },
  { control: { id: 'load', to: 100 }, ms: 1600, wait: 2000 },
  { accel: 1, wait: 200 },
  { isolate: 'plug', say: 'Safety by gravity: a plug of frozen salt holds the fuel in. Lose the cooling, and the plug melts.', wait: 3400 },
  { clear: true, mode: 'cutaway', camera: { az: -40, el: 12 }, accel: 10, press: 'drain', say: 'Drain. The plug thaws and the fuel runs into a tank whose shape cannot sustain a chain reaction.', wait: 12400 },
  { accel: 100, press: 'refill', say: 'Refill: the salt is pushed back up and the plug freezes again.', wait: 3000 },
  { accel: 1, wait: 200 },
  { explode: 1, ms: 1800, say: 'Explode: every subsystem pulled apart.', wait: 2400 },
  { explode: 0, ms: 1400, wait: 400 },
  { isolate: 'tower', say: 'What the plant cannot turn into electricity leaves as clean water vapour. The salt never gets here.', wait: 3200 },
  { resetModel: true, clear: true, camera: 'iso', say: 'Your turn: drag to orbit, press a part button, move a slider. The MSBR was a paper design; only the 7.4 MW MSRE ever ran.', wait: 3600 },
];
export default tour;

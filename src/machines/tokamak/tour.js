// Tokamak tour (about 80 s). Step vocabulary is documented in kit/tour.js. The model opens in a burning flat-top.
export const tour = [
  { camera: 'iso', say: 'ITER, a tokamak, already burning. There is no chain reaction here: the fuel must be made hot, dense and well insulated.', wait: 3600 },
  { isolate: 'plasma', say: 'The plasma: deuterium and tritium gas, ionised and hot. The core is nearly transparent; the cooler edge glows pink.', wait: 3600 },
  { isolate: 'tf', say: 'Toroidal field coils ring the plasma with a strong field. Superconducting, cooled to a few kelvin.', wait: 3300 },
  { isolate: 'cs', say: 'The central solenoid is a transformer primary. A changing current in it drives the current through the plasma.', wait: 3600 },
  { isolate: 'pf', say: 'Poloidal field coils shape and position the plasma. Together the fields twist into helical field lines.', wait: 3300 },
  { isolate: 'nbi', say: 'Heating from outside: neutral beams here, radio waves from the other launchers. Then the alpha particles take over.', wait: 3600 },
  { clear: true, camera: 'iso', mode: 'cutaway', say: 'Gain Q is fusion power divided by heating power. The goal is 10 or more.', wait: 2800 },
  { control: { id: 'heat', to: 73 }, ms: 2400, say: 'More heating: the temperature climbs and fusion power follows steeply.', wait: 3300 },
  { control: { id: 'heat', to: 50 }, ms: 2000, say: 'Back to the reference heating. About two thirds of the heat is now the plasma heating itself.', wait: 3100 },
  { isolate: 'blanket', say: 'The 14.1 MeV neutron is not confined. It flies into the blanket and deposits most of the energy there.', wait: 3600 },
  { isolate: 'hx', say: 'A power plant would breed tritium from lithium here and raise steam. ITER makes no electricity.', wait: 3600 },
  { clear: true, camera: 'iso', mode: 'cutaway', accel: 10, say: 'Now push the density past the Greenwald limit.', wait: 600 },
  { control: { id: 'fuel', to: 1.75 }, ms: 1800, say: 'Too much fuel for the current: the plasma disrupts and dumps its energy on the wall.', wait: 5100 },
  { accel: 1, resetModel: true, say: 'Reset to a healthy pulse. Next the controlled way to stop: a shattered pellet.', wait: 2700 },
  { press: 'mitigate', accel: 10, say: 'Mitigation: injected pellet shards radiate the energy away evenly and the current ramps down.', wait: 5100 },
  { accel: 1, resetModel: true, mode: 'cutaway', say: 'Your turn: start a pulse, change heating or density, take a part apart.', wait: 2700 },
];
export default tour;

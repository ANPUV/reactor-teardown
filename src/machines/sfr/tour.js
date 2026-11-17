// SFR tour (about 80 s). Step vocabulary: kit/tour.js.
export const tour = [
  { say: 'A sodium-cooled fast breeder, the BN-800: heat from the core becomes electricity, and the rest leaves as clean vapour.', wait: 5300 },
  { isolate: 'pool', say: 'No moderator and no water. Neutrons stay fast, and the coolant is liquid sodium in a big pool at about atmospheric pressure.', wait: 6050 },
  { isolate: 'vessel', say: 'One vessel holds the core, the pumps and the heat exchangers. A guard vessel around it catches a leak.', wait: 5300 },
  { isolate: 'core', say: 'MOX fuel, uranium and plutonium oxide, in hexagonal assemblies in three enrichment zones.', wait: 3800 },
  { isolate: 'assembly', say: 'One assembly: pins wrapped with a spiral wire that keeps them apart. Sodium flows between them.', wait: 4550 },
  { isolate: 'pin', say: 'One pin: a stack of fuel pellets in a steel tube, with a gas plenum above.', wait: 4550 },
  { isolate: 'blanket', say: 'Around the core sits depleted uranium. It catches neutrons and turns U-238 into plutonium. The green glow is breeding.', wait: 5300 },
  { isolate: 'ihx', say: 'Primary sodium is radioactive. A second loop of clean sodium keeps it away from the water in the steam generators.', wait: 5550 },
  { isolate: 'turbine', say: 'Steam is hotter than in a water reactor, so more of the heat becomes electricity.', wait: 4300 },
  { isolate: 'cooling', say: 'The rest of the heat leaves as water vapour from a cooling tower. That water never touches the reactor.', wait: 5300 },
  { clear: true, mode: 'cutaway', camera: 'iso', say: 'Back to the whole plant.', wait: 1800 },
  { control: { id: 'rods', to: 78 }, ms: 2400, say: 'Insert the control rods and power falls. Reactivity is counted in dollars: a dollar is small here, because delayed neutrons are few.', wait: 4400 },
  { control: { id: 'rods', to: 88 }, ms: 2000, say: 'Withdraw them: heating of fuel and sodium pulls the power back by itself.', wait: 3200 },
  { control: { id: 'flow', to: 75 }, ms: 2400, say: 'Slow the pumps: the sodium leaves hotter and power drops on its own. Boiling is still far away.', wait: 4200 },
  { control: { id: 'flow', to: 100 }, ms: 1800, wait: 800 },
  { accel: 10, press: 'scram', say: 'SCRAM. Rods drop, power falls to decay heat, the turbine slows and the plume fades. Breeding goes on for days from Np-239.', wait: 6200 },
  { accel: 1, resetModel: true, say: 'Your turn: drag to orbit, press a part button, move a slider.', wait: 3550 },
];
export default tour;

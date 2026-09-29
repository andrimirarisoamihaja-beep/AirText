// Listes de mots pour la génération aléatoire des codes et pseudos.
// Aucune donnée personnelle : ces identités sont purement éphémères.

export const CODE_WORDS = [
  "brume", "cendre", "rivage", "onyx", "sillage", "lumen", "zenith", "delta",
  "source", "abysse", "flamme", "givre", "orage", "dune", "liane", "quartz",
  "vortex", "eclipse", "nebuleuse", "comete", "astre", "soufre", "cyanure", "ivoire",
  "jade", "silex", "basalte", "granit", "lichen", "saule", "erable", "cedre",
  "noyer", "bruyere", "toundra", "fjord", "lagune", "estran", "recif", "mangrove",
  "savane", "steppe", "canyon", "glacier", "iceberg", "volcan", "geyser", "cratere",
  "aurora", "solstice", "equinoxe", "horizon", "meridien", "parallele", "tropique", "zenale",
  "mirage", "oasis", "palme", "roseau", "algue", "corail", "nacre", "ambre",
  "opale", "topaze", "grenat", "zircon", "mica", "feldspath", "obsidienne", "ponce",
  "celadon", "indigo", "ocre", "sienne", "vermillon", "carmin", "outremer", "sepia",
  "cobalt", "malachite", "azurite", "gypse", "talcc", "graphite", "rutile", "stibine",
  "faucon", "heron", "martin", "gorgebleue", "alcyon", "fulmar", "petrel", "sterne",
  "gypaète", "milan", "busard", "crecerelle", "hibou", "chouette", "engoulevent", "torcol",
  "loup", "lynx", "puma", "jaguar", "ocelot", "serval", "manul", "caracal",
  "renard", "fennec", "coyote", "dingo", "chacal", "hyaene", "ratel", "zorrille",
];

export const PSEUDO_ADJ = [
  "silencieux", "nomade", "lunaire", "urbain", "sauvage", "discret", "ardent",
  "nocturne", "solaire", "errant", "libre", "voile", "electrique", "mineral",
  "fluide", "opaque", "translucide", "ephemere", "tenace", "subtil", "grave",
];

export const PSEUDO_NOUN = [
  "renard", "corbeau", "lynx", "heron", "loup", "faucon", "loutre", "blaireau",
  "phantomme", "voyageur", "signal", "echo", "circuit", "relais", "satellite",
  "astre", "ombre", "etincelle", "flux", "noeud", "vecteur",
];

function pick<T>(arr: T[], rnd: Uint32Array, i: number): T {
  return arr[rnd[i % rnd.length] % arr.length];
}

export function generateCode(wordCount = 4): string {
  const rnd = crypto.getRandomValues(new Uint32Array(wordCount + 1));
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) words.push(pick(CODE_WORDS, rnd, i));
  return words.join("-") + "-" + String(rnd[wordCount] % 100).padStart(2, "0");
}

export function generatePseudo(): string {
  const rnd = crypto.getRandomValues(new Uint32Array(3));
  const adj = pick(PSEUDO_ADJ, rnd, 0);
  const noun = pick(PSEUDO_NOUN, rnd, 1);
  return noun + "-" + adj + "-" + String(rnd[2] % 100).padStart(2, "0");
}

/**
 * The built-in tag list (issue #37): themes, seasons, occasions and genres,
 * for any music, in English and French.
 *
 * - A tag's `slug` is its lasting identity. Never rename one: change its
 *   label, or retire it (`retired`: hidden from pickers, kept on songs).
 * - One idea is one tag. Other words for it are `aliases`, per language,
 *   used to match names (catalogue imports, search, the music services'
 *   genres) - never a second tag.
 * - The list reaches servers by a migration (existing servers) and by the
 *   seed (new ones, and Admin's "Run seed"), both upserting by slug. A
 *   change here needs a migration too, the way
 *   `20270203000000_tag_vocabulary` was written.
 */

export type TagAliases = Partial<Record<"en" | "fr", string[]>>;

export interface VocabularyTag {
  slug: string;
  en: string;
  fr: string;
  /** A theme's group (`TAG_GROUPS`); other categories have none. */
  group?: string;
  aliases?: TagAliases;
  /** Hidden from pickers, kept on the songs that have it. */
  retired?: boolean;
}

export interface TagGroup {
  slug: string;
  en: string;
  fr: string;
  /** Which half of the list: themes of life, or of faith. */
  part: "life" | "faith";
}

/** The built-in categories, in the order pickers show them. `style` is shown as Genre. */
export const SEED_TAG_CATEGORIES = [
  { slug: "theme", label: "Theme", fr: "Thème" },
  { slug: "season", label: "Season", fr: "Saison" },
  { slug: "occasion", label: "Occasion", fr: "Occasion" },
  { slug: "style", label: "Genre", fr: "Genre" },
  { slug: "mood", label: "Mood / Energy", fr: "Ambiance" },
  { slug: "instrumentation", label: "Instrumentation", fr: "Instrumentation" },
] as const;

export type SeedTagCategorySlug = (typeof SEED_TAG_CATEGORIES)[number]["slug"];

export const TAG_GROUPS: readonly TagGroup[] = [
  { slug: "love", en: "Love & relationships", fr: "Amour et relations", part: "life" },
  { slug: "feelings", en: "Feelings", fr: "Sentiments", part: "life" },
  { slug: "growing", en: "Growing", fr: "Grandir", part: "life" },
  { slug: "hard-times", en: "Hard times", fr: "Épreuves", part: "life" },
  { slug: "world", en: "World & nature", fr: "Monde et nature", part: "life" },
  { slug: "society", en: "Society", fr: "Société", part: "life" },
  { slug: "celebration", en: "Celebration", fr: "Fête", part: "life" },
  { slug: "god", en: "God", fr: "Dieu", part: "faith" },
  { slug: "jesus", en: "Jesus", fr: "Jésus", part: "faith" },
  { slug: "holy-spirit", en: "Holy Spirit", fr: "Saint-Esprit", part: "faith" },
  { slug: "worship", en: "Worship", fr: "Louange", part: "faith" },
  { slug: "prayer", en: "Prayer", fr: "Prière", part: "faith" },
  { slug: "salvation", en: "Salvation", fr: "Salut", part: "faith" },
  { slug: "faith-life", en: "Life of faith", fr: "Vie de foi", part: "faith" },
  { slug: "word", en: "Word", fr: "Parole", part: "faith" },
  { slug: "church", en: "Church & mission", fr: "Église et mission", part: "faith" },
  { slug: "eternity", en: "Eternity", fr: "Éternité", part: "faith" },
];

type Row = [slug: string, en: string, fr: string, aliases?: TagAliases];

const grouped = (group: string, rows: Row[]): VocabularyTag[] =>
  rows.map(([slug, en, fr, aliases]) => ({ slug, en, fr, group, ...(aliases && { aliases }) }));
const plain = (rows: Row[]): VocabularyTag[] => rows.map(([slug, en, fr, aliases]) => ({ slug, en, fr, ...(aliases && { aliases }) }));

const THEMES: VocabularyTag[] = [
  ...grouped("love", [
    ["love", "Love", "Amour", { en: ["loving", "beloved"], fr: ["aimer", "bien-aimé"] }],
    ["romance", "Romance", "Romance", { en: ["romantic", "in love", "love song"], fr: ["romantique", "amoureux", "chanson d'amour"] }],
    ["heartbreak", "Heartbreak", "Rupture", { en: ["breakup", "broken heart", "lost love"], fr: ["chagrin d'amour", "cœur brisé", "séparation"] }],
    ["friendship", "Friendship", "Amitié", { en: ["friends", "friend"], fr: ["amis", "ami"] }],
    ["family", "Family", "Famille", { en: ["families"], fr: ["familles"] }],
    ["parents", "Parents", "Parents", { en: ["mother", "mum", "mom", "dad"], fr: ["mère", "maman", "papa"] }],
    ["childhood", "Childhood", "Enfance", { en: ["growing up", "kids"], fr: ["enfant"] }],
    ["home", "Home", "Maison", { en: ["homecoming", "house"], fr: ["chez soi", "foyer", "retour"] }],
    ["togetherness", "Togetherness", "Être ensemble", { en: ["together", "belonging"], fr: ["ensemble", "appartenance"] }],
  ]),
  ...grouped("feelings", [
    ["joy", "Joy", "Joie", { en: ["joyful", "rejoicing", "rejoice"], fr: ["joyeux", "réjouissance", "se réjouir"] }],
    ["happiness", "Happiness", "Bonheur", { en: ["happy"], fr: ["heureux"] }],
    ["peace", "Peace", "Paix", { en: ["peaceful", "serenity"], fr: ["paisible", "sérénité"] }],
    ["hope", "Hope", "Espérance", { en: ["hopeful"], fr: ["espoir"] }],
    ["gratitude", "Gratitude", "Gratitude", { en: ["thankfulness", "grateful", "thankful"], fr: ["merci", "reconnaissant"] }],
    ["wonder", "Wonder", "Émerveillement", { en: ["awe", "amazement", "marvel"], fr: ["émerveiller", "admiration"] }],
    ["longing", "Longing", "Désir", { en: ["yearning", "desire"], fr: ["désirer", "aspiration"] }],
    ["nostalgia", "Nostalgia", "Nostalgie", { en: ["memories", "remembering"], fr: ["souvenirs", "souvenir"] }],
    ["calm", "Calm", "Calme", { en: ["stillness", "quiet"], fr: ["tranquillité", "silence"] }],
  ]),
  ...grouped("growing", [
    ["courage", "Courage", "Courage", { en: ["brave", "boldness"], fr: ["audace", "hardiesse"] }],
    ["strength", "Strength", "Force", { en: ["strong"], fr: ["fort"] }],
    ["freedom", "Freedom", "Liberté", { en: ["liberty", "deliverance", "free"], fr: ["délivrance", "libération", "libre"] }],
    ["healing", "Healing", "Guérison", { en: ["heal", "health"], fr: ["guérir", "santé"] }],
    ["identity", "Identity", "Identité", { en: ["who I am", "self-worth"], fr: ["qui je suis", "estime de soi"] }],
    ["change", "Change", "Changement", { en: ["transformation"], fr: ["transformation"] }],
    ["new-beginnings", "New beginnings", "Nouveau départ", { en: ["fresh start", "starting over"], fr: ["recommencer"] }],
    ["journey", "Journey", "Chemin", { en: ["road", "path", "pilgrimage"], fr: ["voyage", "route", "pèlerinage"] }],
    ["dreams", "Dreams", "Rêves", { en: ["dream"], fr: ["rêve"] }],
    ["perseverance", "Perseverance", "Persévérance", { en: ["endurance", "overcoming"], fr: ["endurance", "tenir bon"] }],
    ["victory", "Victory", "Victoire", { en: ["triumph", "overcome"], fr: ["triomphe", "vaincre"] }],
  ]),
  ...grouped("hard-times", [
    ["grief", "Grief", "Deuil", { en: ["mourning", "sorrow"], fr: ["chagrin", "tristesse"] }],
    ["loss", "Loss", "Perte", { en: ["losing"], fr: ["perdre"] }],
    ["loneliness", "Loneliness", "Solitude", { en: ["lonely", "alone"], fr: ["seul"] }],
    ["fear-and-anxiety", "Fear & anxiety", "Peur et angoisse", { en: ["fear", "anxiety", "worry", "afraid"], fr: ["peur", "angoisse", "anxiété", "inquiétude"] }],
    ["struggle", "Struggle", "Combat", { en: ["battle", "fight", "trials", "testing"], fr: ["lutte", "épreuve", "bataille"] }],
    ["brokenness", "Brokenness", "Blessure", { en: ["broken", "wounds", "hurt"], fr: ["blessures", "brisé"] }],
    ["comfort", "Comfort", "Consolation", { en: ["consolation", "encouragement"], fr: ["réconfort", "encouragement"] }],
    ["lament", "Lament", "Lamentation", { en: ["lamentation", "crying out"], fr: ["complainte", "cri"] }],
    ["waiting", "Waiting", "Attente", { en: ["patience", "wait"], fr: ["patience", "attendre"] }],
  ]),
  ...grouped("world", [
    ["creation", "Creation", "Création", { en: ["new creation", "creator"], fr: ["nouvelle création", "créateur"] }],
    ["nature", "Nature", "Nature", { en: ["earth", "mountains", "sky"], fr: ["terre", "montagnes", "ciel étoilé"] }],
    ["light", "Light", "Lumière", { en: ["shine", "sun"], fr: ["briller", "soleil"] }],
    ["night", "Night", "Nuit", { en: ["darkness", "evening"], fr: ["ténèbres", "soir"] }],
    ["sea", "Sea", "Mer", { en: ["ocean", "waves"], fr: ["océan", "vagues"] }],
    ["seasons-of-life", "Seasons of life", "Saisons de la vie", { en: ["passing time"], fr: ["le temps qui passe"] }],
    ["beauty-of-the-world", "Beauty of the world", "Beauté du monde", { en: ["beauty", "beautiful world"], fr: ["beauté"] }],
  ]),
  ...grouped("society", [
    ["justice", "Justice", "Justice", { en: ["injustice", "fairness"], fr: ["injustice", "équité"] }],
    ["peace-on-earth", "Peace on earth", "Paix sur la terre", { en: ["world peace"], fr: ["paix dans le monde"] }],
    ["unity", "Unity", "Unité", { en: ["united"], fr: ["unis", "un seul corps"] }],
    ["service", "Service", "Service", { en: ["serving", "servant"], fr: ["servir", "serviteur"] }],
    ["generosity", "Generosity", "Générosité", { en: ["giving", "sharing"], fr: ["donner", "partage"] }],
    ["poverty", "Poverty", "Pauvreté", { en: ["the poor"], fr: ["pauvres"] }],
    ["freedom-of-peoples", "Freedom of peoples", "Liberté des peuples", { en: ["civil rights", "oppression", "slavery"], fr: ["droits civiques", "oppression", "esclavage"] }],
    ["homeland", "Homeland", "Patrie", { en: ["country", "nation", "patriotic"], fr: ["pays", "nation", "patriotique"] }],
  ]),
  ...grouped("celebration", [
    ["celebration", "Celebration", "Célébration", { en: ["celebrate"], fr: ["célébrer"] }],
    ["dance", "Dance", "Danse", { en: ["dancing"], fr: ["danser"] }],
    ["party", "Party", "Fête", { en: ["festival"], fr: ["faire la fête", "festival"] }],
    ["thanksgiving", "Thanksgiving", "Reconnaissance", { en: ["giving thanks", "thanks"], fr: ["action de grâce", "actions de grâces", "rendre grâce"] }],
    ["blessing", "Blessing", "Bénédiction", { en: ["blessed", "bless"], fr: ["béni", "bénir"] }],
  ]),
  ...grouped("god", [
    ["majesty", "Majesty", "Majesté", { en: ["greatness", "almighty", "awesome god"], fr: ["grandeur", "tout-puissant"] }],
    ["holiness", "Holiness", "Sainteté", { en: ["holy"], fr: ["saint"] }],
    ["glory", "Glory", "Gloire", { en: ["god's glory", "glorious"], fr: ["glorieux", "gloire de dieu"] }],
    ["power", "Power", "Puissance", { en: ["mighty", "omnipotence"], fr: ["puissant", "toute-puissance"] }],
    ["king-and-kingdom", "King & kingdom", "Roi et royaume", { en: ["king", "kingdom", "sovereignty", "lordship", "reign"], fr: ["roi", "royaume", "souveraineté", "seigneurie", "règne"] }],
    ["father", "Father", "Père", { en: ["abba", "heavenly father"], fr: ["abba", "père céleste"] }],
    ["faithfulness", "Faithfulness", "Fidélité", { en: ["faithful", "unchanging"], fr: ["fidèle", "immuable"] }],
    ["goodness", "Goodness", "Bonté", { en: ["good", "kindness"], fr: ["bon", "bienveillance"] }],
    ["love-of-god", "Love of God", "Amour de Dieu", { en: ["god's love", "divine love", "love of christ"], fr: ["amour divin", "amour du christ"] }],
    ["wisdom", "Wisdom", "Sagesse", { en: ["wise"], fr: ["sage"] }],
  ]),
  ...grouped("jesus", [
    ["name-of-jesus", "Name of Jesus", "Nom de Jésus", { en: ["jesus", "christ", "messiah", "emmanuel", "son of god"], fr: ["jésus", "christ", "messie", "emmanuel", "fils de dieu"] }],
    ["saviour", "Saviour", "Sauveur", { en: ["savior", "redeemer"], fr: ["rédempteur"] }],
    ["cross", "Cross", "Croix", { en: ["calvary", "crucifixion", "passion"], fr: ["calvaire", "crucifixion", "passion"] }],
    ["blood", "Blood", "Sang", { en: ["the blood"], fr: ["le sang"] }],
    ["lamb-and-sacrifice", "Lamb & sacrifice", "Agneau et sacrifice", { en: ["lamb", "sacrifice", "atonement"], fr: ["agneau", "sacrifice", "expiation"] }],
    ["resurrection", "Resurrection", "Résurrection", { en: ["risen", "empty tomb"], fr: ["ressuscité", "tombeau vide"] }],
    ["return-of-christ", "Return of Christ", "Retour du Christ", { en: ["second coming", "he is coming"], fr: ["retour de jésus", "il revient"] }],
  ]),
  ...grouped("holy-spirit", [
    ["holy-spirit", "Holy Spirit", "Saint-Esprit", { en: ["spirit", "holy ghost"], fr: ["esprit saint", "esprit"] }],
    ["presence", "Presence", "Présence", { en: ["presence of god", "dwelling"], fr: ["présence de dieu"] }],
    ["revival", "Revival", "Réveil", { en: ["renewal", "awakening"], fr: ["renouveau", "renouveau spirituel"] }],
    ["fire-and-anointing", "Fire & anointing", "Feu et onction", { en: ["fire", "anointing", "gifts of the spirit"], fr: ["feu", "onction", "dons de l'esprit"] }],
    ["trinity", "Trinity", "Trinité", { en: ["doxology", "father son and holy spirit"], fr: ["doxologie", "père fils et saint-esprit"] }],
  ]),
  ...grouped("worship", [
    ["praise", "Praise", "Louange", { en: ["hallelujah", "alleluia", "exaltation"], fr: ["alléluia", "louer", "exaltation"] }],
    ["adoration", "Adoration", "Adoration", { en: ["worship", "honour", "honor"], fr: ["adorer", "honneur"] }],
    ["proclamation", "Proclamation", "Proclamation", { en: ["declaration", "declare"], fr: ["déclaration", "proclamer"] }],
    ["surrender", "Surrender", "Abandon", { en: ["submission", "yield"], fr: ["soumission", "s'abandonner"] }],
    ["consecration", "Consecration", "Consécration", { en: ["devotion", "dedication", "commitment"], fr: ["dévotion", "engagement"] }],
  ]),
  ...grouped("prayer", [
    ["prayer", "Prayer", "Prière", { en: ["petition", "asking", "pray"], fr: ["supplication", "demande", "prier"] }],
    ["intercession", "Intercession", "Intercession", { en: ["intercede"], fr: ["intercéder"] }],
    ["longing-for-god", "Longing for God", "Soif de Dieu", { en: ["seeking", "pursuit", "hunger", "thirst", "seek"], fr: ["chercher dieu", "recherche", "faim", "soif"] }],
    ["listening", "Listening", "Écoute", { en: ["meditation", "listen"], fr: ["méditation", "écouter"] }],
  ]),
  ...grouped("salvation", [
    ["salvation", "Salvation", "Salut", { en: ["saved"], fr: ["sauvé"] }],
    ["grace", "Grace", "Grâce", { en: ["gracious", "favour", "favor"], fr: ["faveur"] }],
    ["mercy", "Mercy", "Miséricorde", { en: ["merciful", "compassion"], fr: ["compassion"] }],
    ["forgiveness", "Forgiveness", "Pardon", { en: ["forgiven", "forgive"], fr: ["pardonné", "pardonner"] }],
    ["repentance", "Repentance", "Repentance", { en: ["repent", "confession"], fr: ["repentir", "confession"] }],
    ["redemption", "Redemption", "Rédemption", { en: ["redeemed", "ransom"], fr: ["racheté", "rançon"] }],
    ["restoration", "Restoration", "Restauration", { en: ["restore"], fr: ["restaurer"] }],
    ["new-life", "New life", "Vie nouvelle", { en: ["born again", "new birth"], fr: ["nouvelle naissance", "né de nouveau"] }],
    ["identity-in-christ", "Identity in Christ", "Identité en Christ", { en: ["child of god", "adoption", "chosen"], fr: ["enfant de dieu", "adoption", "choisi"] }],
  ]),
  ...grouped("faith-life", [
    ["faith", "Faith", "Foi", { en: ["believe", "belief"], fr: ["croire", "croyance"] }],
    ["trust", "Trust", "Confiance", { en: ["confidence", "rely"], fr: ["se confier", "assurance"] }],
    ["obedience", "Obedience", "Obéissance", { en: ["obey"], fr: ["obéir"] }],
    ["following-jesus", "Following Jesus", "Suivre Jésus", { en: ["discipleship", "follow", "disciple"], fr: ["disciple", "suivre"] }],
    ["rest", "Rest", "Repos", { en: ["abide", "abiding"], fr: ["demeurer"] }],
    ["refuge-and-protection", "Refuge & protection", "Refuge et protection", { en: ["refuge", "protection", "shelter", "security", "fortress"], fr: ["refuge", "protection", "abri", "sécurité", "forteresse"] }],
    ["provision", "Provision", "Provision", { en: ["providence", "provider", "sufficiency"], fr: ["providence", "pourvoir"] }],
    ["guidance", "Guidance", "Direction", { en: ["lead", "shepherd"], fr: ["conduire", "berger", "guide"] }],
  ]),
  ...grouped("word", [
    ["word-of-god", "Word of God", "Parole de Dieu", { en: ["bible", "scripture", "word"], fr: ["bible", "écriture", "parole"] }],
    ["promises", "Promises", "Promesses", { en: ["promise"], fr: ["promesse"] }],
    ["truth", "Truth", "Vérité", { en: ["true"], fr: ["vrai"] }],
  ]),
  ...grouped("church", [
    ["church", "Church", "Église", { en: ["body of christ", "fellowship", "community"], fr: ["corps du christ", "communauté", "assemblée"] }],
    ["loving-others", "Loving others", "Aimer son prochain", { en: ["neighbour", "neighbor", "love one another"], fr: ["prochain", "aimez-vous les uns les autres"] }],
    ["mission", "Mission", "Mission", { en: ["evangelism", "witness", "nations"], fr: ["évangélisation", "témoignage", "nations"] }],
    ["calling", "Calling", "Appel", { en: ["call", "purpose", "vocation"], fr: ["vocation", "appel de dieu"] }],
  ]),
  ...grouped("eternity", [
    ["heaven", "Heaven", "Ciel", { en: ["new jerusalem", "paradise"], fr: ["paradis", "nouvelle jérusalem", "cieux"] }],
    ["eternal-life", "Eternal life", "Vie éternelle", { en: ["eternity", "everlasting"], fr: ["éternité", "éternel"] }],
  ]),
];

const SEASONS: VocabularyTag[] = plain([
  ["new-year", "New Year", "Nouvel an", { en: ["new year's"], fr: ["nouvelle année", "jour de l'an"] }],
  ["spring", "Spring", "Printemps"],
  ["summer", "Summer", "Été"],
  ["autumn", "Autumn", "Automne", { en: ["fall"] }],
  ["winter", "Winter", "Hiver"],
  ["holidays", "Holidays", "Vacances", { en: ["vacation"] }],
  ["advent", "Advent", "Avent"],
  ["christmas", "Christmas", "Noël", { en: ["nativity", "incarnation", "xmas"], fr: ["nativité", "incarnation"] }],
  ["lent", "Lent", "Carême"],
  ["easter", "Easter", "Pâques", { en: ["holy week"], fr: ["semaine sainte"] }],
  ["ascension", "Ascension", "Ascension"],
  ["pentecost", "Pentecost", "Pentecôte"],
  ["harvest", "Harvest & thanksgiving", "Moisson et action de grâce", { en: ["harvest"], fr: ["moisson", "fête des récoltes"] }],
]);

const OCCASIONS: VocabularyTag[] = plain([
  ["opening", "Opening", "Ouverture", { en: ["welcome", "gathering"], fr: ["accueil", "début"] }],
  ["closing", "Closing", "Fin", { en: ["ending", "farewell"], fr: ["clôture", "au revoir"] }],
  ["wedding", "Wedding", "Mariage", { en: ["marriage"], fr: ["noces"] }],
  ["funeral-and-memorial", "Funeral", "Funérailles", { en: ["memorial", "funeral & memorial"], fr: ["obsèques", "enterrement"] }],
  ["birthday", "Birthday", "Anniversaire"],
  ["children", "Children", "Enfants", { en: ["kids", "children's"], fr: ["enfance", "jeunesse"] }],
  ["lullaby", "Lullaby", "Berceuse", { en: ["bedtime"] }],
  ["communion", "Communion", "Sainte cène", { en: ["lord's supper", "eucharist"], fr: ["communion", "cène", "eucharistie"] }],
  ["offering", "Offering", "Offrande", { en: ["offertory", "tithe"], fr: ["offrandes", "dîme"] }],
  ["baptism", "Baptism", "Baptême"],
  ["sending", "Sending", "Envoi", { en: ["benediction", "commissioning"], fr: ["bénédiction finale"] }],
  ["childrens-dedication", "Children's dedication", "Présentation d'enfants", { en: ["dedication", "baby dedication"], fr: ["présentation", "dédicace"] }],
]);

const GENRES: VocabularyTag[] = plain([
  ["pop", "Pop", "Pop"],
  ["rock", "Rock", "Rock", { en: ["hard rock", "classic rock"] }],
  ["indie", "Indie", "Indie", { en: ["indie pop", "indie rock"] }],
  ["alternative", "Alternative", "Alternatif", { en: ["alternative rock", "alt"], fr: ["rock alternatif"] }],
  ["metal", "Metal", "Métal", { en: ["heavy metal", "hard rock & metal"] }],
  ["punk", "Punk", "Punk", { en: ["punk rock"] }],
  ["folk", "Folk & acoustic", "Folk et acoustique", { en: ["folk", "acoustic"], fr: ["folk", "acoustique"] }],
  ["singer-songwriter", "Singer-songwriter", "Auteur-compositeur", { fr: ["auteur-compositeur-interprète"] }],
  ["country", "Country", "Country", { en: ["americana", "bluegrass"] }],
  ["blues", "Blues", "Blues"],
  ["jazz", "Jazz", "Jazz"],
  ["rnb-and-soul", "R&B & soul", "R&B et soul", { en: ["r&b", "rnb", "soul", "r&b/soul"], fr: ["soul"] }],
  ["funk", "Funk", "Funk"],
  ["hip-hop", "Hip-hop", "Hip-hop", { en: ["rap", "hip-hop/rap"], fr: ["rap"] }],
  ["electronic", "Electronic", "Électro", { en: ["electro", "edm", "techno", "house"], fr: ["électronique"] }],
  ["dance-music", "Dance", "Dance", { en: ["dance music", "club"] }],
  ["ambient", "Ambient", "Ambient", { en: ["new age", "chill"], fr: ["ambiance"] }],
  ["classical", "Classical", "Classique", { en: ["classical music", "baroque", "orchestral music"], fr: ["musique classique", "baroque"] }],
  ["opera", "Opera", "Opéra"],
  ["soundtrack", "Soundtrack", "Bande originale", { en: ["film score", "musicals", "film", "ost"], fr: ["musique de film", "comédie musicale", "bo"] }],
  ["chanson", "Chanson", "Chanson française", { en: ["french chanson", "french pop"], fr: ["chanson"] }],
  ["variety", "Variety", "Variété", { en: ["variété"], fr: ["variété française", "variétés"] }],
  ["latin", "Latin", "Latino", { en: ["latin music", "salsa", "reggaeton"], fr: ["musique latine", "salsa"] }],
  ["reggae", "Reggae", "Reggae", { en: ["dancehall", "ska"] }],
  ["african", "African", "Africain", { en: ["afrobeats", "afrobeat", "afro", "african music"], fr: ["musique africaine", "afro"] }],
  ["caribbean", "Caribbean", "Caribéen", { en: ["zouk", "compas", "kompa", "soca"], fr: ["zouk", "kompa", "antillais"] }],
  ["world", "World", "Musiques du monde", { en: ["world music", "traditional", "folk music"], fr: ["world", "musique traditionnelle"] }],
  ["childrens-music", "Children's", "Pour enfants", { en: ["children's music", "kids music"], fr: ["musique pour enfants", "chansons pour enfants"] }],
  ["instrumental", "Instrumental", "Instrumental"],
  ["contemporary", "Contemporary worship", "Louange contemporaine", { en: ["worship", "praise & worship", "contemporary", "ccm"], fr: ["louange", "adoration contemporaine"] }],
  ["gospel", "Gospel", "Gospel", { en: ["black gospel", "southern gospel", "urban gospel", "christian & gospel"] }],
  ["traditional-hymn", "Hymn", "Cantique", { en: ["hymns", "traditional hymn"], fr: ["cantiques", "hymne", "hymne traditionnel"] }],
  ["choral", "Choral", "Chorale", { en: ["choir", "choral music"], fr: ["chœur", "musique chorale"] }],
  ["liturgical", "Liturgical & Taizé", "Liturgique et Taizé", { en: ["liturgical", "taizé", "chant", "gregorian"], fr: ["liturgique", "taizé", "grégorien"] }],
  ["spirituals", "Spiritual", "Negro spiritual", { en: ["spirituals", "negro spiritual"], fr: ["spiritual", "negro spirituals"] }],
  ["christian-pop-and-rock", "Christian pop & rock", "Pop et rock chrétiens", { en: ["christian pop", "christian rock", "christian", "contemporary christian music"], fr: ["pop chrétienne", "rock chrétien", "musique chrétienne"] }],
  // Merged into Folk & acoustic: kept on the songs that have it.
  ["acoustic", "Acoustic", "Acoustique"],
]).map((tag) => (tag.slug === "acoustic" ? { ...tag, retired: true } : tag));

/** The built-in tags by category, in picker order. */
export const TAG_VOCABULARY: Readonly<Partial<Record<SeedTagCategorySlug, readonly VocabularyTag[]>>> = {
  theme: THEMES,
  season: SEASONS,
  occasion: OCCASIONS,
  style: GENRES,
};

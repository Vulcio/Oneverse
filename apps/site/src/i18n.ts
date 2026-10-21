// The page's words, in each language. The app and the docs are in the same two.
export const APP_URL = import.meta.env.PUBLIC_APP_URL ?? "https://songverse.top";
export const DOCS_URL = "https://docs.songverse.one";

export const text = {
  en: {
    lang: "en",
    title: "Songverse — your songs, ready to play",
    description: "Charts, arrangements and set lists for musicians, bands and teams. Chords right above the words, in the key you're playing, on any screen.",
    docs: "Docs",
    signIn: "Sign in",
    openApp: "Open Songverse",
    otherLanguage: { label: "Français", href: "/fr/" },
    heroTitle: ["Your songs,", "ready to play."],
    heroText: "Charts, arrangements and set lists in one place — chords right above the words, in the key you're playing, on any screen.",
    getStarted: "Get started",
    readDocs: "Read the docs",
    pictureAlt: "A keyboard player on stage, a chord chart on a tablet above the keys, the band behind in the lights",
    featuresTitle: "Made for playing, not paperwork",
    features: [
      {
        title: "Charts that read well",
        text: "Chords sit over the syllable they're played on. Transpose in a tap, read capo shapes or solfège, and the chart keeps its shape.",
      },
      {
        title: "One song, every arrangement",
        text: "Change a song's order, key, capo or chords for your band without touching the song. Each player can hide what isn't for them.",
      },
      {
        title: "Set lists that travel",
        text: "Plan a set, pick each song's key and arrangement, and share it with a link: guest musicians can read every chart in it.",
      },
    ],
    forWhoTitle: "For anyone who plays with others",
    forWhoText: "Bands, choirs, worship teams, session players, the friend who always brings a guitar. In English and French, in any browser.",
    ctaTitle: "Ready when you are.",
    footerDocs: "Documentation",
    footerApp: "The app",
  },
  fr: {
    lang: "fr",
    title: "Songverse — vos chants, prêts à jouer",
    description: "Grilles, arrangements et listes de chants pour les musiciens, les groupes et les équipes. Les accords juste au-dessus des paroles, dans la tonalité jouée, sur tous les écrans.",
    docs: "Documentation",
    signIn: "Se connecter",
    openApp: "Ouvrir Songverse",
    otherLanguage: { label: "English", href: "/" },
    heroTitle: ["Vos chants,", "prêts à jouer."],
    heroText: "Grilles, arrangements et listes de chants au même endroit — les accords juste au-dessus des paroles, dans la tonalité jouée, sur tous les écrans.",
    getStarted: "Commencer",
    readDocs: "Lire la documentation",
    pictureAlt: "Un claviériste sur scène, une grille d'accords sur une tablette au-dessus du clavier, le groupe derrière dans les lumières",
    featuresTitle: "Fait pour jouer, pas pour la paperasse",
    features: [
      {
        title: "Des grilles lisibles",
        text: "Les accords se placent sur la syllabe où ils se jouent. Transposez d'un geste, lisez les formes de capo ou le solfège, et la grille garde sa forme.",
      },
      {
        title: "Un chant, tous ses arrangements",
        text: "Changez l'ordre, la tonalité, le capo ou des accords pour votre groupe sans toucher au chant. Chaque musicien masque ce qui ne le concerne pas.",
      },
      {
        title: "Des listes qui voyagent",
        text: "Préparez une liste, choisissez la tonalité et l'arrangement de chaque chant, et partagez-la par lien : les musiciens invités lisent chaque grille.",
      },
    ],
    forWhoTitle: "Pour tous ceux qui jouent ensemble",
    forWhoText: "Groupes, chorales, équipes de louange, musiciens de studio, l'ami qui vient toujours avec sa guitare. En français et en anglais, dans tous les navigateurs.",
    ctaTitle: "Prêt quand vous l'êtes.",
    footerDocs: "Documentation",
    footerApp: "L'application",
  },
} as const;

export type Text = (typeof text)[keyof typeof text];

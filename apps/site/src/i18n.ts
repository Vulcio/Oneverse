// The page's words, in each language. The apps and the docs are in the same two.
export const SONGVERSE_URL = import.meta.env.PUBLIC_APP_URL ?? "https://songverse.top";
export const PLANIVERSE_URL = import.meta.env.PUBLIC_PLANIVERSE_URL ?? "https://planiverse.top";
export const ACCOUNT_URL = import.meta.env.PUBLIC_ONEVERSE_URL ?? "https://account.oneverse.top";
export const DOCS_URL = "https://docs.oneverse.top";

export const text = {
  en: {
    lang: "en",
    title: "Oneverse — songs, plans and screens for teams who play together",
    description: "Oneverse brings together Songverse, for musicians and their charts, and Planiverse, for planning who serves when. One account, the same sets, on any screen.",
    docs: "Docs",
    signIn: "Sign in",
    openApp: "Open Songverse",
    otherLanguage: { label: "Français", href: "/fr/" },
    heroTitle: ["One account,", "every part of the service."],
    heroText: "Songs and charts for the musicians, plans and rotas for everyone else, the same sets on every screen — with one account at Oneverse.",
    getStarted: "Get started",
    readDocs: "Read the docs",
    pictureAlt: "A keyboard player on stage, a chord chart on a tablet above the keys, the band behind in the lights",
    appsTitle: "The apps",
    apps: [
      {
        name: "Songverse",
        title: "Songs, ready to play",
        text: "Charts with chords over the words, in the key you're playing; arrangements for each band; set lists, practice and Live for musicians.",
        open: "Open Songverse",
      },
      {
        name: "Planiverse",
        title: "Who's on, and when",
        text: "Events, rotas and calendars for an organisation's groups, with answers and line-ups — for everyone who plans without playing.",
        open: "Open Planiverse",
      },
    ],
    featuresTitle: "Shared by every app",
    features: [
      {
        title: "One account",
        text: "Sign in once at Oneverse, with a password, Google or a passkey, and every app knows you.",
      },
      {
        title: "Teams and organisations",
        text: "Teams, groups and their roles are the same everywhere: plan a date in Planiverse, play its set in Songverse.",
      },
      {
        title: "Sets on every screen",
        text: "A set's songs on the musicians' tablets and the room's screens, in step with the one leading it.",
      },
    ],
    forWhoTitle: "For churches, bands and anyone who serves together",
    forWhoText: "Worship teams, choirs, bands and the people who plan around them. In English and French, in any browser. Free software (AGPL-3.0).",
    ctaTitle: "Ready when you are.",
    footerDocs: "Documentation",
    footerAccount: "Your account",
  },
  fr: {
    lang: "fr",
    title: "Oneverse — chants, plannings et écrans pour les équipes qui jouent ensemble",
    description: "Oneverse réunit Songverse, pour les musiciens et leurs grilles, et Planiverse, pour planifier qui sert quand. Un seul compte, les mêmes listes, sur tous les écrans.",
    docs: "Documentation",
    signIn: "Se connecter",
    openApp: "Ouvrir Songverse",
    otherLanguage: { label: "English", href: "/" },
    heroTitle: ["Un seul compte,", "pour tout le service."],
    heroText: "Les chants et les grilles pour les musiciens, les plannings pour tous les autres, les mêmes listes sur tous les écrans — avec un seul compte Oneverse.",
    getStarted: "Commencer",
    readDocs: "Lire la documentation",
    pictureAlt: "Un claviériste sur scène, une grille d'accords sur une tablette au-dessus du clavier, le groupe derrière dans les lumières",
    appsTitle: "Les applications",
    apps: [
      {
        name: "Songverse",
        title: "Des chants prêts à jouer",
        text: "Des grilles avec les accords au-dessus des paroles, dans la tonalité jouée ; des arrangements pour chaque groupe ; listes, répétition et Live pour les musiciens.",
        open: "Ouvrir Songverse",
      },
      {
        name: "Planiverse",
        title: "Qui est là, et quand",
        text: "Événements, plannings et calendriers pour les groupes d'une organisation, avec les réponses et les équipes — pour tous ceux qui planifient sans jouer.",
        open: "Ouvrir Planiverse",
      },
    ],
    featuresTitle: "Commun à toutes les applications",
    features: [
      {
        title: "Un seul compte",
        text: "Connectez-vous une fois sur Oneverse, avec un mot de passe, Google ou une clé d'accès, et chaque application vous reconnaît.",
      },
      {
        title: "Équipes et organisations",
        text: "Les équipes, les groupes et leurs rôles sont les mêmes partout : planifiez une date dans Planiverse, jouez sa liste dans Songverse.",
      },
      {
        title: "Les listes sur tous les écrans",
        text: "Les chants d'une liste sur les tablettes des musiciens et les écrans de la salle, au rythme de celui qui la mène.",
      },
    ],
    forWhoTitle: "Pour les églises, les groupes et tous ceux qui servent ensemble",
    forWhoText: "Équipes de louange, chorales, groupes et ceux qui s'organisent autour d'eux. En français et en anglais, dans tous les navigateurs. Logiciel libre (AGPL-3.0).",
    ctaTitle: "Prêt quand vous l'êtes.",
    footerDocs: "Documentation",
    footerAccount: "Votre compte",
  },
} as const;

export type Text = (typeof text)[keyof typeof text];

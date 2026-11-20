// The page's words, in each language. The apps and the docs are in the same two.
export const SONGVERSE_URL = import.meta.env.PUBLIC_APP_URL ?? "https://songverse.top";
export const PLANIVERSE_URL = import.meta.env.PUBLIC_PLANIVERSE_URL ?? "https://plan.oneverse.top";
export const ONEVERSE_URL = import.meta.env.PUBLIC_ONEVERSE_URL ?? "https://app.oneverse.top";
export const SCREEN_URL = import.meta.env.PUBLIC_SCREEN_URL ?? "https://screen.oneverse.top";
export const DOCS_URL = "https://docs.oneverse.top";

export const text = {
  en: {
    lang: "en",
    title: "Oneverse — one home for your whole community",
    description: "Oneverse is where your church, band or team meets: your dates, your teams and the news, with Songverse for the musicians, Oneverse Plan for the rotas and Screen for the room. One account, free software.",
    docs: "Docs",
    signIn: "Sign in",
    openOneverse: "Open Oneverse",
    otherLanguage: { label: "Français", href: "/fr/" },
    heroTitle: ["One home", "for your whole community."],
    heroText: "Your next dates, your teams and the news of your church or band, in one place. And from there, the songs for the musicians, the rotas for everyone else and the words on the screens.",
    readDocs: "Read the docs",
    heroPoints: ["One account for every app", "Teams and organisations", "Free software"],
    musicians: "For musicians",
    songverseTitle: ["Songs,", "ready to play."],
    songverseText: "Songverse is where the band gets ready: every song in the key you're playing, every set in its order, and the same page on stage.",
    songversePoints: [
      { title: "Charts and arrangements", text: "Chords over the words or as a grid of bars, transposed, with capo and notes, and an arrangement for each band." },
      { title: "Sets and practice", text: "The set in order, the recordings and stems to practise with, the metronome and the tuner." },
      { title: "Live, together", text: "On stage every tablet follows the leader: the song, the section and the beat, in step." },
    ],
    openSongverse: "Open Songverse",
    songverseAlt: "A keyboard player on stage, a chord chart on a tablet above the keys, the band behind in the lights",
    aroundTitle: ["Plan the week,", "run the screens."],
    aroundText: "Oneverse Plan for every group's dates and rotas, Screen for what the room sees: the same people, teams and sets as Songverse.",
    later: "Coming later",
    apps: [
      { key: "plan", name: "Oneverse Plan", title: "Who's on, and when", text: "Events, rotas and calendars for every group, from the music team to the kids' club and the welcome desk. Everyone answers whether they can come.", open: "Open Oneverse Plan" },
      { key: "screen", name: "Screen", title: "The words on every screen", text: "Songs, Scriptures and notices on the room's screens, the stage monitor and the stream, run from one console or following the set.", open: "Open Screen" },
      { key: "slideverse", name: "Slideverse", title: "Presentations, in the set", text: "Your PowerPoint and PDF slides beside the songs, shown on the same screens.", open: "" },
    ],
    forWhoTitle: "For churches, bands and every team around them",
    forWhoText: "Worship teams, choirs, bands and the people who plan around them. In English and French, in any browser. Free software (AGPL-3.0).",
    ctaTitle: "Ready when you are.",
    footerDocs: "Documentation",
  },
  fr: {
    lang: "fr",
    title: "Oneverse — un seul lieu pour toute votre communauté",
    description: "Oneverse, c'est là où votre église, votre groupe ou votre équipe se retrouve : vos dates, vos équipes et les nouvelles, avec Songverse pour les musiciens, Oneverse Plan pour les plannings et Screen pour la salle. Un seul compte, logiciel libre.",
    docs: "Documentation",
    signIn: "Se connecter",
    openOneverse: "Ouvrir Oneverse",
    otherLanguage: { label: "English", href: "/" },
    heroTitle: ["Un seul lieu", "pour toute votre communauté."],
    heroText: "Vos prochaines dates, vos équipes et les nouvelles de votre église ou de votre groupe, au même endroit. Et de là, les chants pour les musiciens, les plannings pour tous les autres et les paroles sur les écrans.",
    readDocs: "Lire la documentation",
    heroPoints: ["Un seul compte pour toutes les applications", "Équipes et organisations", "Logiciel libre"],
    musicians: "Pour les musiciens",
    songverseTitle: ["Des chants,", "prêts à jouer."],
    songverseText: "Songverse, c'est là où le groupe se prépare : chaque chant dans la tonalité jouée, chaque liste dans son ordre, et la même page sur scène.",
    songversePoints: [
      { title: "Grilles et arrangements", text: "Les accords au-dessus des paroles ou en grille de mesures, transposés, avec capo et notes, et un arrangement pour chaque groupe." },
      { title: "Listes et répétition", text: "La liste dans l'ordre, les enregistrements et les pistes pour répéter, le métronome et l'accordeur." },
      { title: "Le Live, ensemble", text: "Sur scène, chaque tablette suit celui qui mène : le chant, la partie et le temps, ensemble." },
    ],
    openSongverse: "Ouvrir Songverse",
    songverseAlt: "Un claviériste sur scène, une grille d'accords sur une tablette au-dessus du clavier, le groupe derrière dans les lumières",
    aroundTitle: ["Planifier la semaine,", "piloter les écrans."],
    aroundText: "Oneverse Plan pour les dates et les plannings de chaque groupe, Screen pour ce que la salle voit : les mêmes personnes, équipes et listes que dans Songverse.",
    later: "Bientôt",
    apps: [
      { key: "plan", name: "Oneverse Plan", title: "Qui est là, et quand", text: "Événements, plannings et calendriers pour chaque groupe, de l'équipe de louange au club des enfants et à l'accueil. Chacun répond s'il peut venir.", open: "Ouvrir Oneverse Plan" },
      { key: "screen", name: "Screen", title: "Les paroles sur tous les écrans", text: "Chants, Écritures et annonces sur les écrans de la salle, le retour de scène et la diffusion, depuis une seule console ou au fil de la liste.", open: "Ouvrir Screen" },
      { key: "slideverse", name: "Slideverse", title: "Les présentations, dans la liste", text: "Vos diapositives PowerPoint et PDF à côté des chants, sur les mêmes écrans.", open: "" },
    ],
    forWhoTitle: "Pour les églises, les groupes et toutes les équipes autour d'eux",
    forWhoText: "Équipes de louange, chorales, groupes et ceux qui s'organisent autour d'eux. En français et en anglais, dans tous les navigateurs. Logiciel libre (AGPL-3.0).",
    ctaTitle: "Prêt quand vous l'êtes.",
    footerDocs: "Documentation",
  },
} as const;

export type Text = (typeof text)[keyof typeof text];

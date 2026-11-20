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
    description: "Oneverse is one home for your whole community, from one person to a band to a whole organisation: Songverse for the musicians, Oneverse Plan for the rotas and Screen for the room. Real time, in the cloud, free software.",
    docs: "Docs",
    signIn: "Sign in",
    openOneverse: "Open Oneverse",
    otherLanguage: { label: "Français", href: "/fr/" },
    heroTitle: ["One home", "for your whole community."],
    heroText: "Your next dates, your teams and your news, in one place. And from there, the songs for the musicians, the rotas for everyone else and the words on the screens.",
    readDocs: "Read the docs",
    heroPoints: ["Real time", "In the cloud", "Unlimited screens"],
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
      { key: "plan", name: "Oneverse Plan", title: "Who's on, and when", text: "Events, rotas and calendars for every group, from the band to the kids' club and the welcome desk. Everyone answers whether they can come.", open: "Open Oneverse Plan" },
      { key: "screen", name: "Screen", title: "The words on every screen", text: "Songs, Scriptures and notices on the room's screens, the stage monitor and the stream, run from one console or following the set.", open: "Open Screen" },
      { key: "slideverse", name: "Slideverse", title: "Presentations, in the set", text: "Your PowerPoint and PDF slides beside the songs, shown on the same screens.", open: "" },
    ],
    scaleTitle: ["From one person", "to a whole organisation."],
    scaleText: "Start on your own and grow: nothing to move when more people join.",
    scale: [
      { title: "On your own", text: "Your songs, charts and practice, on every device you have." },
      { title: "A team or a band", text: "Share songs and sets, answer for the next dates, play in step." },
      { title: "An organisation", text: "Many groups under one roof, with their events, rotas, screens and brand." },
    ],
    highlightsTitle: ["Real time,", "in the cloud."],
    highlights: [
      { title: "Real time", text: "A change shows on every device at once, and the band and the screens follow whoever leads, in step." },
      { title: "In the cloud", text: "Nothing to install: open it in any browser, on a phone, a tablet or a laptop, and pick up where you left off." },
      { title: "Modern", text: "Fast and clear, light or dark, in English and French, with your sets kept on the device for when the network drops." },
      { title: "Unlimited screens", text: "Pair as many screens as the room needs, from the main wall to the stage monitor and the stream." },
    ],
    forWhoTitle: "Free software, yours to run",
    forWhoText: "Open it in your browser, or run it on your own server. AGPL-3.0, in English and French.",
    ctaTitle: "Ready when you are.",
    footerDocs: "Documentation",
  },
  fr: {
    lang: "fr",
    title: "Oneverse — un seul lieu pour toute votre communauté",
    description: "Oneverse, un seul lieu pour toute votre communauté, d'une personne à un groupe et à toute une organisation : Songverse pour les musiciens, Oneverse Plan pour les plannings et Screen pour la salle. En temps réel, dans le cloud, logiciel libre.",
    docs: "Documentation",
    signIn: "Se connecter",
    openOneverse: "Ouvrir Oneverse",
    otherLanguage: { label: "English", href: "/" },
    heroTitle: ["Un seul lieu", "pour toute votre communauté."],
    heroText: "Vos prochaines dates, vos équipes et vos nouvelles, au même endroit. Et de là, les chants pour les musiciens, les plannings pour tous les autres et les paroles sur les écrans.",
    readDocs: "Lire la documentation",
    heroPoints: ["En temps réel", "Dans le cloud", "Écrans illimités"],
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
    scaleTitle: ["D'une seule personne", "à toute une organisation."],
    scaleText: "Commencez seul et grandissez : rien à déménager quand d'autres vous rejoignent.",
    scale: [
      { title: "Seul", text: "Vos chants, vos grilles et vos répétitions, sur tous vos appareils." },
      { title: "Une équipe ou un groupe", text: "Partagez chants et listes, répondez pour les prochaines dates, jouez ensemble." },
      { title: "Une organisation", text: "Plusieurs groupes sous un même toit, avec leurs événements, plannings, écrans et leur identité." },
    ],
    highlightsTitle: ["En temps réel,", "dans le cloud."],
    highlights: [
      { title: "En temps réel", text: "Un changement apparaît partout à la fois, et le groupe et les écrans suivent celui qui mène, ensemble." },
      { title: "Dans le cloud", text: "Rien à installer : ouvrez-le dans n'importe quel navigateur, sur téléphone, tablette ou ordinateur, et reprenez où vous en étiez." },
      { title: "Moderne", text: "Rapide et clair, en clair ou en sombre, en français et en anglais, avec vos listes gardées sur l'appareil quand le réseau tombe." },
      { title: "Écrans illimités", text: "Associez autant d'écrans que la salle en demande, du grand mur au retour de scène et à la diffusion." },
    ],
    forWhoTitle: "Un logiciel libre, à vous",
    forWhoText: "Ouvrez-le dans votre navigateur, ou installez-le sur votre propre serveur. AGPL-3.0, en français et en anglais.",
    ctaTitle: "Prêt quand vous l'êtes.",
    footerDocs: "Documentation",
  },
} as const;

export type Text = (typeof text)[keyof typeof text];

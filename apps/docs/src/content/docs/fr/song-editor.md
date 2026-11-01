---
title: L'éditeur de chants
description: Écrire et modifier une grille avec les accords au-dessus des paroles, organiser ses sections et l'ordre dans lequel on le chante.
---

Ouvrez un chant et choisissez l'onglet **Éditeur**.

![L'éditeur de chants](../../../assets/screenshots/fr/song-editor.jpg)

La barre d'outils de l'éditeur reste en haut de l'écran quand vous faites défiler. Elle a les trois modes de l'éditeur à gauche, puis **Annuler**, **Rétablir** et la ligne de note, puis la **Tonalité** du chant, **Transposer**, **Tempo**, **Mesure** et **Capo**. Ses boutons ne bougent jamais quand vous vous en servez : appuyez sur **Transposer** + encore et encore, ou sur **Annuler**, sans regarder. Un outil qui ne sert pas dans un mode y est grisé plutôt que retiré.

Les trois modes :

- **Visuel** - la grille avec les accords au-dessus des mots. C'est là que vous passerez le plus de temps.
- **Texte** - la même grille en texte ChordPro, pour des modifications rapides en bloc. Les accords et les lignes que vous ne changez pas restent tels quels.
- **Aperçu** - la grille telle que les musiciens la verront. Sur un écran large, elle s'affiche aussi à côté de **Visuel** et **Texte**, mise à jour au fil de la saisie.

**Visuel** utilise la même police que l'aperçu : **Police** dans son panneau **Affichage**, **Chasse fixe** ou **Proportionnelle**. Dans les deux cas, chaque accord reste au-dessus de sa lettre. Là où deux accords sont plus proches que la largeur du premier, un peu d'espace est laissé entre leurs mots.

## Les accords

- **Tapez un accord** entre crochets à l'endroit où il se joue : `[G]Amazing grace`.
- **Déplacez un accord** en le faisant glisser sur une autre lettre, ou sélectionnez-le et utilisez les flèches ← →.
- **Cliquez sur un accord** pour le changer (avec des suggestions de la tonalité du chant et des variantes comme `G7` ou `Gsus4`) ou le supprimer.
- Le **panneau des accords**, à droite de la grille et toujours visible quand vous faites défiler, liste les **accords de la tonalité** du chant (avec leur degré : I, IV, V…) et ceux **Dans ce chant**. Cliquez sur l'un d'eux pour l'ajouter au curseur, ou faites-le glisser sur un mot. **Autre accord** en ajoute un autre.
- Sur un téléphone ou une tablette, les accords sont dans une barre en bas de l'écran, au-dessus du clavier. Touchez-en un pour l'ajouter au curseur ; pas besoin de taper `[G]`. Toucher un accord de la grille le sélectionne et range le clavier, pour que rien ne soit caché ; un accord sélectionné, touchez-en un autre dans la barre pour le mettre à sa place. La barre commence alors par les outils de cet accord - le déplacer d'une lettre à gauche ou à droite, ou le supprimer - et ajoute ses variantes (G7, Gsus4…).
- Sur un écran tactile, **appuyez longuement sur un accord** de la grille pour le faire glisser : il se soulève, et la lettre où il ira est mise en évidence. Un balayage rapide fait défiler la page.

Modifier les paroles garde les accords avec elles : taper avant un accord l'emmène, et supprimer des mots qui portent des accords laisse les accords à l'endroit des mots, pour que vous les replaciez. Entrée coupe une ligne, et ses accords suivent leurs mots.

## Les barres de mesure

Les barres de mesure marquent le début de chaque mesure, dans les paroles, comme sur une grille de jazz : `|Amazing |grace how |sweet the |sound`. La [ligne des mesures et la grille en mesures](/fr/metronome/#grille-en-mesures) les suivent, le clic aussi. Sans elles, les mesures viennent des accords (voir [Mesures](/fr/metronome/#mesures)).

- **Barres de mesure**, dans la barre d'outils, les remplit d'après les accords - **Remplir cette section d'après ses accords** ou **Remplir tout le chant d'après ses accords** - pour partir de là, et les retire (**Retirer les barres de mesure de cette section**, **Retirer toutes les barres de mesure**).
- **Tapez `|`** dans les paroles pour en ajouter une au curseur, ou faites glisser **Barre de mesure** depuis le panneau des accords (sous **Mesures**) sur les paroles, là où commence une mesure.
- **Faites glisser une barre de mesure par sa poignée** - le point sous les paroles - sur une autre lettre. Sur un écran tactile, appuyez longuement d'abord : elle se soulève et suit votre doigt le long de sa ligne.
- **Cliquez sur une barre de mesure** (touchez-la sur un écran tactile) pour la sélectionner. Ses outils s'affichent dessous, ou dans la barre en bas de l'écran sur un téléphone ou une tablette : **Déplacer la barre de mesure à gauche** et **Déplacer la barre de mesure à droite** d'une lettre (les flèches ← → aussi), **Une mesure de moins** et **Une mesure de plus** pour des mesures sans paroles à elles - un mot tenu, une mesure instrumentale - affichées **×2** sous la poignée, et **Supprimer la barre de mesure**.

Les accords entre deux barres de mesure tombent dans leur mesure sur les temps qu'atteignent leurs paroles : un accord à la moitié des paroles d'une mesure est sur son troisième temps en 4/4.

### Les temps dans les paroles

Dans une section avec des barres de mesure, les autres temps de chaque mesure s'affichent en petits numéros sous les lettres où ils sont chantés, le temps 1 étant la barre de mesure elle-même. Ce sont les mêmes temps que dans les mesures (voir [Placer les temps dans les paroles](/fr/metronome/#placer-les-temps-dans-les-paroles)) : placés d'eux-mêmes, ou par vous. Un numéro en pointillés est un temps tenu sur un mot.

- **Faites glisser un temps** sur une autre lettre de sa mesure, ou **touchez-le puis touchez la lettre** : pratique sur un téléphone, où faire glisser de petites choses est délicat. Un temps reste entre le temps d'avant et celui d'après ; là où il ne peut pas aller, il clignote en rouge et reste où il était.
- Un temps que vous avez placé est rempli. **Touchez-le deux fois** pour laisser la grille le placer de nouveau.

Ils sont enregistrés avec le chant.

## Les sections

Chaque bloc est une section : intro, couplet, pré-refrain, refrain, post-refrain, pont, vamp (une phrase répétée autant qu'il faut), break, instrumental, interlude, outro ou tag.

Chaque type a sa couleur, légère - couplets en bleu, refrains en ambre, ponts en violet… - sur son étiquette et en un léger fond derrière ses lignes : on distingue d'un coup d'œil les parties du chant.

- **Ajoutez une section** avec le **+** entre deux sections (il apparaît sous le pointeur, et toujours sur un écran tactile), au-dessus de la première, ou avec **Ajouter une section** à la fin. Son menu a tous les types de section, et **Chanter à nouveau** : une copie liée d'une section déjà dans le chant, chantée là.
- Le titre d'une section est son nom. Laissé tel quel, elle est nommée par son type, dans la langue du lecteur, et numérotée dans l'ordre où les sections sont écrites quand le chant en a plus d'une de ce type : « Couplet 1 », « Couplet 2 », mais « Refrain » quand il n'y a qu'un refrain. Une section chantée à nouveau (une copie liée, une reprise) garde le nom de celle qu'elle reprend, partout : la grille, le Live, l'ordre du chant, les écrans et les notes. Cliquez sur le titre pour lui donner un nom à elle (« Dernier refrain »). La petite étiquette colorée à côté est son **type** : choisissez-la pour en changer.
- Les outils de la section - l'œil, ses duplications, monter et descendre, et son menu **⋯** - apparaissent sur la section que vous modifiez, ou sous le pointeur. Leur place est gardée : rien ne bouge quand ils apparaissent. L'œil masque son nom (« Refrain ») sur la grille en Session et en Live.
- Le menu **⋯** la déplace, la duplique (liée ou en copie indépendante, voir [Copies liées](/fr/song-editor/#copies-liées)), la retire de l'ordre du chant ou la supprime.
- Une ligne peut être une **note pour le groupe** (« ×2, montée ») plutôt que des paroles.

## Tonalité et transposition

Choisissez la **Tonalité** du chant dans la barre d'outils. **Transposer** − et + déplacent tous les accords et la tonalité d'un demi-ton ; **Annuler** remet les deux. **Tempo**, **Mesure** et **Capo** sont ceux du chant, les mêmes que dans l'onglet **Infos**, et sont enregistrés avec lui.

Sur un téléphone, la barre en bas de l'écran a toujours **Enregistrer le chant** : grisé tant qu'il n'y a rien à enregistrer.

## L'ordre du chant

L'**Ordre du chant**, au-dessus de la grille, est l'ordre dans lequel on le chante ; chaque fois qu'on chante une section est un *passage*. Chaque passage a la couleur de sa section.

![L'ordre du chant](../../../assets/screenshots/fr/song-order.jpg)

- **+ Chanter…** ajoute un passage : le refrain une nouvelle fois, par exemple.
- **Choisissez un passage** - ou cliquez dans sa section sur la grille - et ses actions s'affichent dans la barre sous l'ordre : **Plus tôt**, **Plus tard**, **Rechanter juste après**, **Dupliquer (copie indépendante)** (une section à part, après lui), **Renommer** (« Dernier refrain »), **Changement de tonalité** et **Note pour les musiciens**. Le dernier bouton est **Retirer ce passage** ; sur le seul passage d'une section, c'est **Retirer de l'ordre du chant**. La barre garde sa place et sa hauteur, qu'un passage soit choisi ou non : vous pouvez appuyer sur **Plus tôt** encore et encore sans regarder. Choisir un passage fait défiler jusqu'à sa section.
- **Faites glisser les passages** pour les réordonner. Sur un écran tactile, appuyez d'abord longuement sur un passage ; un balayage rapide fait défiler la page.
- **Suivre les sections** revient à chanter chaque section une fois, dans l'ordre.

Les changements de tonalité et les notes s'affichent sur la grille à ce passage.

### Copies liées

L'éditeur montre le chant dans l'ordre où il est chanté. La première apparition d'une section est le bloc que vous modifiez ; partout où elle est rechantée, c'est une **copie liée** - marquée d'un lien, « Liée à Refrain », verrouillée - qui suit la section : modifiez la section et chaque copie le montre.

Une copie est repliée sur une ligne qui dit ce qu'elle fait - « chantée à nouveau, telle qu'écrite », « 2 demi-tons plus haut · en A », « 1 accord à elle », « 1 ligne laissée de côté ». **Afficher** l'ouvre, avec sa transposition et **Modifier cette copie** ; **Masquer** la replie. Elle reste comme vous l'avez laissée pendant que vous modifiez le chant.

- **Dupliquer (liée)** dans le menu d'une section en ajoute une copie juste après ; **Dupliquer (copie indépendante)** ajoute une section indépendante. Dans le menu d'une copie, **Dupliquer (liée)** ajoute une autre copie avec les mêmes modifications, toujours liée à la section, pas à la copie. Monter et descendre les blocs (leur menu) change l'ordre où ils sont chantés, comme l'**Ordre du chant** au-dessus.
- Quand l'éditeur a de la place, les flèches pour monter et descendre un bloc et ses duplications sont aussi à droite de son titre, à côté de son menu : sur une section, **Dupliquer (liée)** (le lien) et **Dupliquer (copie indépendante)** (l'icône de copie) ; sur une copie liée, **Dupliquer (liée)** (l'icône de copie).
- **− / +** dans le titre d'une copie transpose cette copie seule (un changement de tonalité, dans l'ordre du chant, vaut jusqu'à la fin du chant).
- **Modifier cette copie** ouvre ses modifications, qui restent des différences avec la section, si bien qu'elle continue de la suivre : **Retirer la ligne**, changer ses paroles (les mots retirés s'affichent grisés et barrés, les nouveaux surlignés, et les accords suivent leurs mots), ou taper un autre accord sur l'un d'eux (écrit dans la tonalité du chant) ou le retirer avec le bouton en forme d'œil. **Terminé** la verrouille de nouveau.
- Une copie avec ses propres paroles, lignes ou accords porte une **\*** dans son titre, dans l'ordre du chant et sur la grille. Une copie seulement transposée n'est pas marquée : elle montre de combien (**+2**). **Comme la section est écrite** (son menu) retire les modifications ; **Rendre indépendante** en fait une section à part, ses modifications écrites dedans - elle ne suit plus l'originale.
- **Retirer de l'ordre du chant** (menu d'une section) place une section à la fin, sous **Pas dans l'ordre du chant**, avec ses copies ; **Remettre dans l'ordre du chant** la ramène.

Si une ligne ou un accord qu'une copie modifie est supprimé de la section, la grille le signale au lieu de l'ignorer. Exportée en ChordPro, une copie modifiée est écrite en entier.

### Sections reprises

Un fichier lu (un nouveau chant, une grille collée ou envoyée) lie ce qu'il écrit à nouveau : un refrain écrit une deuxième fois est une copie liée du premier - aussi quand il est quelques demi-tons plus haut ou plus bas (une copie transposée), quand un tiers de ses accords au plus diffère (une copie avec ces accords à elle), ou quand ce n'est que la fin du refrain.

Un chant écrit avant garde ses sections en double. Au-dessus de l'éditeur, ses éditeurs voient ce qui se répète - « Refrain 2 est Refrain 1 avec 1 accord à elle », « Dernier refrain est Refrain 1, 2 demi-ton(s) plus haut » - et **Lier** chacune, ou **Tout lier** : la reprise devient une copie liée de la section, en gardant son nom. Les arrangements et les repères des enregistrements suivent, et l'**Historique** du chant permet d'annuler. Enregistrez d'abord vos modifications.

## Coller une grille

Collez une grille entière n'importe où - en ChordPro, ou avec les accords écrits au-dessus des paroles - et elle devient des sections avec les accords en place. Coller de simples paroles les tape, tout simplement. Un nom de section seul sur sa ligne (« Strophe 1 », « [Refrain] », « Pont », « Chorus », « Coro ») commence une section de ce type, en français, anglais, espagnol, allemand, italien ou portugais. Un nom qui ne dit que ce que la section s'appellerait de toute façon (« Strophe 2 » sur la deuxième strophe) n'est pas gardé comme son nom : elle suit la langue du lecteur et la numérotation. Une ligne `{chorus}` - le refrain chanté à nouveau - ajoute la reprise à l'ordre du chant comme copie liée, comme le fait un fichier lu, et **Annuler** reprend tout le collage en une fois.

Une partie sans paroles - une intro, un instrumental - peut s'écrire en mesures : `| G | C | D | G |`, une mesure entre chaque paire de barres. Elle arrive en ligne d'accords avec ses mesures, prête dans la [grille en mesures](/fr/metronome/#grille-en-mesures). Dans une mesure, des points ou des barres obliques marquent les temps (`| C . D . |` met D sur le temps 3), `%` reprend la mesure d'avant, les signes de reprise (`||: … :||`) comptent comme des barres de mesure, et `x2` à la fin joue la ligne deux fois. Une ligne d'accords seuls, sans barres de mesure, garde l'espace entre ses accords.

## Remplacer la grille

**Remplacer depuis un fichier ou un collage…**, dans la barre d'outils, lit une nouvelle grille pour tout le chant : envoyez un fichier (`.cho`, `.txt` ou `.pdf`) ou collez les paroles et les accords, puis **Remplacer la grille**. Ce qui ne change pas garde sa place - les copies liées, les [versions](/fr/versions/) et les sections des enregistrements le suivent - et **Annuler les modifications** remet l'ancienne grille tant que vous n'avez pas enregistré. (Un nouveau chant reçoit sa grille dans l'onglet **Infos**.)

## Enregistrer

**Enregistrer le chant** enregistre la grille et les détails du chant ensemble. Si quelqu'un d'autre a enregistré le chant après que vous l'avez ouvert, Songverse vous le dit au lieu d'écraser ses modifications.

## Modifier à plusieurs

Quand quelqu'un d'autre a le chant ouvert dans l'éditeur, l'en-tête l'indique (**Sam modifie ce chant**). C'est aussi indiqué en Session, sous le nom du chant.

Quand cette personne enregistre, vous êtes prévenu aussitôt, par-dessus la page, sans que rien ne bouge pendant que vous travaillez :

- Sans modification de votre côté, **Charger** fait venir sa version.
- Avec des modifications pas encore enregistrées, charger la sienne abandonne les vôtres : **Abandonner les miennes et charger**, ou **Continuer** pour regarder d'abord. Enregistrer les vôtres sera alors refusé, avec le même choix, plutôt que d'écraser ce qu'elle a enregistré.

En Session, un enregistrement s'affiche comme **Chant modifié · Charger** ; la grille ne change que quand vous le touchez.

### Écrire à plusieurs

Là où un administrateur a activé **Modification à plusieurs en direct** (voir [Administration](/fr/admin/#collaboration)), les personnes qui peuvent modifier le chant y écrivent ensemble dans le mode **Visuel** de l'éditeur. Chacun voit ce que les autres tapent au fil de la frappe, avec leur curseur et leur nom. Cela vaut pour les paroles, les accords, les parties, l'ordre du chant, la tonalité et la transposition.

- **Annuler** ne reprend que vos propres modifications, pas ce que les autres ont tapé entre-temps.
- **Enregistrer le chant** enregistre le chant tel que tout le monde l'a. Après l'enregistrement de quelqu'un, les autres continuent sans être prévenus d'un enregistrement ailleurs, et chacun peut enregistrer à nouveau.
- **Annuler les modifications** abandonne ce que personne n'a enregistré, pour tous ceux qui sont dans le chant.
- Les détails (**Infos** : titre, crédits, tempo…) ne s'écrivent pas ensemble : ceux de chacun restent les siens jusqu'à ce qu'il enregistre. L'enregistrement de quelqu'un d'autre apporte les siens là où vous ne les aviez pas changés. Là où vous avez changé le même tous les deux, le vôtre est gardé et un message le nomme, avec qui a enregistré : **Garder le mien** (votre enregistrement remplace le sien) ou **Prendre le sien**.
- Quitter l'éditeur pour un autre onglet vous laisse dans le chant : un enregistrement depuis **Infos** enregistre la grille telle que tout le monde l'a, jamais une plus ancienne.
- Tant que quelqu'un d'autre est dans le chant, le mode **Texte** ne fait qu'afficher la grille ; modifiez-la en **Visuel**.
- Si le chant est modifié ailleurs pendant ce temps (une version restaurée depuis l'**Historique**, une suggestion acceptée), tous ceux qui y sont reçoivent le chant tel qu'il est enregistré, et les modifications que personne n'avait enregistrées sont abandonnées. Un message par-dessus la page l'indique.

Là où elle est désactivée, chacun modifie de son côté, comme décrit plus haut.

## Historique

L'onglet **Historique** liste chaque enregistrement du chant, du plus récent au plus ancien : qui l'a enregistré, quand, et ce qui a changé - la **grille**, les **détails** (titre, tonalité, droits…) ou les **crédits**. Les enregistrements d'une même personne à quelques minutes d'intervalle comptent pour une étape.

![L'historique d'un chant](../../../assets/screenshots/fr/song-history.jpg)

Choisissez une étape pour voir ce qu'elle a changé : détails et crédits avec l'ancienne valeur barrée et la nouvelle à côté, et les lignes de la grille supprimées et ajoutées. **Voir tout le chant tel qu'il était** montre le chant à cette étape.

Si vous pouvez modifier le chant, **Restaurer cet état** remet sa grille, ses détails et ses crédits tels qu'ils étaient à cette étape. C'est enregistré comme toute autre modification : la restauration apparaît dans l'historique et peut elle-même être annulée. Les étiquettes, fichiers, liens et versions ne font pas partie de l'historique et restent tels quels. Enregistrez ou annulez vos propres modifications avant de restaurer.

Les chants créés avant l'historique commencent par **Avant le début de l'historique** : le chant tel qu'il était alors.

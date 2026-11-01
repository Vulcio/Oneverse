---
title: Fournisseurs de chants
description: Trouver accords et infos de chants sur des serveurs extérieurs, en connecter un en tant qu'administrateur, ou faire tourner le vôtre selon l'API Fournisseur de chants.
---

Un **fournisseur de chants** est un serveur extérieur à Songverse qui a des chants : le catalogue d'un éditeur, la bibliothèque de votre église, un convertisseur pour un autre service. Là où un administrateur en a connecté un, Songverse peut y chercher des chants : leurs détails et leur pochette dans la **Détection automatique**, des photos d'artistes, et leurs accords et paroles avec **Trouver les accords**. Songverse parle à chaque fournisseur de la même façon, l'**API Fournisseur de chants** : n'importe qui peut proposer des chants en faisant tourner un serveur qui la suit.

## Trouver les accords

Quand un fournisseur de chants est connecté pour les accords, la boîte **Contenu du chant** d'un chant (dans **Infos**, quand vous ajoutez un chant) montre **Trouver les accords**, avec les fournisseurs où il cherche. Il cherche le nom du chant ; changez ce qu'il cherche dans sa boîte, puis **Chercher**.

Chaque chant trouvé est une ligne, même quand plusieurs fournisseurs l'ont : son artiste, son album et son année, et, quand les services de musique de la détection automatique ont le même chant, **Aussi sur** avec leurs noms (Apple Music, Deezer, Spotify, MusicBrainz). En dessous viennent ses versions - des grilles dans une autre tonalité, plus simples, avec un capodastre, d'autres personnes ou d'autres sites - la mieux notée d'abord. Une note compte combien de personnes l'ont donnée : une grille notée 4,7 par cent personnes passe avant une grille notée 5 par une seule. Chaque version montre sa tonalité, son capodastre, qui l'a écrite, sa note et d'où elle vient (**De** un site **chez** le fournisseur qui l'a trouvée). La meilleure s'affiche d'abord ; **Voir ses versions** les montre toutes.

**Utiliser cette grille** met les accords et paroles de cette version dans la boîte, en ChordPro : vérifiez-les, et changez ce qu'il faut avant d'**Enregistrer le chant**. Les détails que vous n'avez pas encore remplis - l'artiste, les auteurs, la tonalité, le capodastre, le tempo, la mesure, le numéro CCLI et le copyright - sont aussi repris du fournisseur. Sous la boîte, une ligne dit d'où vient la grille, avec ce que le fournisseur permet d'en faire.

Quand les services de musique ont aussi le chant, la détection automatique montre ensuite **Ce que ce résultat complète** : leurs détails et ceux du fournisseur, réunis (album, année de sortie, durée, ISRC, pochette…), dans l'ordre que l'administrateur leur a donné. Cochez ce que vous voulez, puis **Utiliser la sélection** ou **Tout utiliser** ; le lien vers ces services est enregistré avec le chant, comme quand vous choisissez un résultat de la [détection automatique](/fr/song-editor/).

Sur un chant qui existe, **Remplacer depuis un fichier ou un collage…** de l'éditeur a aussi **Trouver les accords** (voir [Remplacer la grille](/fr/song-editor/#remplacer-la-grille)).

N'utilisez qu'une grille dont vous avez les droits : la ligne du fournisseur dit ce qu'il permet.

<div data-audience="admin">

## Connecter un fournisseur

Dans **Administration > Extensions**, l'extension **Fournisseur de chants** est désactivée tant que vous ne l'**activez** pas (ou que `song-provider` n'est pas listé dans la variable d'environnement `PLUGINS_ENABLED` ; **Revenir aux variables d'environnement** y revient).

Sous **Serveurs**, **Ajouter un serveur** :

- **Adresse** : l'adresse du fournisseur, comme `https://songs.example.com` (avec ou sans `/v1`).
- **Clé** : la clé que le fournisseur vous a donnée, s'il en demande une. Elle est gardée chiffrée avec `SETTINGS_ENCRYPTION_KEY` et plus jamais affichée ; **Modifier** en prend une nouvelle, ou **Supprimer la clé enregistrée**.
- **Nom** : laissé vide, le nom que le fournisseur se donne.
- **Sur ce réseau** : pour un fournisseur que vous faites tourner à côté de Songverse, sur une adresse privée ou locale (`http://192.168.1.20:4100`). Sans cela, l'adresse doit être publique et commencer par `https://`.

**Ajouter** demande d'abord au fournisseur ce à quoi il répond : un fournisseur qui ne répond pas, ou refuse la clé, n'est pas ajouté, et la page dit pourquoi. Chaque serveur montre ensuite pour quoi il est **Interrogé**, parmi ce à quoi il répond : **Infos du chant**, **Pochettes**, **Photos d'artistes** et **Accords et paroles**. Décochez-en un pour ne plus le lui demander, ou décochez **Activé** pour ne plus l'interroger du tout. **Tester la connexion** l'interroge à nouveau ; sa dernière erreur, s'il y en a une, s'affiche dessous. Les serveurs sont interrogés dans leur ordre : la flèche en monte un.

Pour les infos du chant, les pochettes et les photos d'artistes, les fournisseurs sont aussi listés comme **Song providers** dans Administration > Métadonnées (voir [Administration](/fr/admin/#maintenance-du-serveur)), avec les autres services, dans l'ordre que vous y choisissez.

Songverse appelle un fournisseur depuis son serveur, jamais depuis le navigateur des gens, avec les mêmes règles que pour toute adresse extérieure : pas de redirections, au plus 2 Mo par réponse, 8 secondes au plus. Une image n'est téléchargée que depuis l'adresse du fournisseur lui-même ou l'hébergeur d'images d'un service de musique.

</div>

## Faire tourner votre propre fournisseur

Un fournisseur répond à cinq requêtes, sous `/v1`, en JSON, en prenant la clé comme `Authorization: Bearer <clé>` :

| Requête | Ce qu'il répond |
| --- | --- |
| `GET /v1/capabilities` | Son `name`, l'`apiVersion` qu'il parle (`1`) et ce qu'il fournit (`provides`) : `songInfo`, `artwork`, `artistPictures`, `chords`. |
| `POST /v1/search` | Les chants qui correspondent à un `title` (et `artist`, `language`), au plus `limit` : chacun avec son `id`, son `title`, ses `artists`, `hasContent` quand il a ses accords, et ses `versions` quand il a plusieurs grilles. |
| `GET /v1/songs/{id}` | Les détails d'un chant : auteurs, album, date de sortie, tonalité, tempo, mesure, durée, ISRC, numéro CCLI, pochette, copyright et liens. |
| `GET /v1/songs/{id}/content` | Ses accords et paroles : `format` `chordpro` avec le texte ChordPro, ou `song-document/v2` avec un SongDocument, et son `copyright` et ses `rights`. `?version=` demande l'une de ses versions. |
| `GET /v1/artists/picture?name=…` | La photo d'un artiste (`url`, `pageUrl`), ou 404. |

Un chant qui a plusieurs grilles les liste dans `versions`, chacune avec son propre `id` (renvoyé comme `?version=`) et, quand il les connaît : un `name` (« Original », « Simplifiée »), `key`, `capo`, `author`, `rating` (`value` sur 5 et `count`, combien l'ont notée) et `source` (`name` et `url` du site ou de la personne d'où elle vient, quand votre serveur rassemble des grilles d'ailleurs). Un chant qui n'a qu'une grille n'en liste aucune et dit `hasContent`.

Une erreur est un statut 4xx ou 5xx avec `{ "error": { "code": "not-found", "message": "…" } }`. Les champs que Songverse ne connaît pas sont ignorés, un fournisseur peut donc envoyer les siens ; une réponse qui ne correspond pas est refusée en entier, et montrée à l'administrateur comme une erreur de ce fournisseur.

La description complète est un fichier OpenAPI 3.1, [`docs/song-provider-api.json`](https://github.com/Vulcio/Oneverse/blob/main/docs/song-provider-api.json) dans le dépôt de Songverse, écrit à partir des mêmes schémas que ceux avec lesquels Songverse lit les réponses. Un petit serveur d'exemple, sans dépendances, est à côté dans [`examples/song-provider/server.mjs`](https://github.com/Vulcio/Oneverse/blob/main/examples/song-provider/server.mjs) : lancez-le avec `node examples/song-provider/server.mjs`, ajoutez `http://localhost:4100` avec la clé `example-key` et **Sur ce réseau**, puis remplacez ses chants par les vôtres. Les tests de Songverse l'utilisent comme fournisseur.

## Extensions

Une extension ajoute une source de chants à Songverse : l'extension Fournisseur de chants est la première, intégrée à Songverse. Chacune dit ce qu'elle apporte - infos du chant, pochettes, photos d'artistes, accords et paroles - et Songverse la sollicite là où c'est utilisé : la Détection automatique, la pochette d'un chant, la page d'un artiste, Trouver les accords. Pour l'instant toutes les extensions sont intégrées, de confiance comme le reste de Songverse ; installer des extensions d'ailleurs, chacune tenue à l'écart du serveur, viendra plus tard.

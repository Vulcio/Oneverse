---
title: Votre propre stockage
description: Gardez les fichiers de votre organisation dans votre propre bucket - ce que cela change, qui peut les voir, ce qui est à votre charge, et comment le mettre en place chez chaque fournisseur.
---

Une organisation peut garder les fichiers des chants de ses équipes - enregistrements, pistes, PDF et autres pièces jointes - dans un bucket à elle plutôt que sur ce serveur. Cette page dit ce que cela change et comment le mettre en place ; [Son propre stockage](/fr/organizations/#son-propre-stockage) dit comment marche la carte **Stockage propre**.

Il faut que l'administrateur de ce serveur le permette (**Les organisations peuvent utiliser leur propre stockage**) et qu'un de vos rôles permette le **Stockage propre des organisations** : sinon, la carte dit à qui le demander.

## Pourquoi l'utiliser

- **Votre espace :** autant que vous en payez, plutôt que ce que ce serveur donne à vos équipes. Sous **Par défaut**, vous fixez vos propres limites - par équipe, par personne, le plus gros fichier - et vos propres rôles peuvent donner plus à certains (voir [Ses rôles propres](/fr/organizations/#ses-rôles-propres)).
- **Votre facture :** le fournisseur vous facture directement ce que vous gardez et envoyez. Cloudflare R2 ne facture pas les téléchargements, ce qui convient aux enregistrements souvent écoutés.
- **Vos fichiers, où vous voulez :** dans la région que vous choisissez, sous votre propre compte, que vous pouvez quitter en arrêtant de l'utiliser (tout revient d'abord sur ce serveur).

## Qui peut voir vos fichiers

- **Dans Songverse,** seuls ceux qui peuvent ouvrir un chant ouvrent ses fichiers, comme avant : les membres de son équipe et ceux avec qui il est partagé. Les administrateurs de ce serveur ne voient pas votre bucket dans l'application, et personne ne peut le parcourir via Songverse.
- **Le serveur garde votre clé.** Pour ranger vos fichiers et les envoyer à vos membres, ce serveur garde la clé de votre bucket, chiffrée. Qui gère ce serveur - ses administrateurs, et son hébergement - pourrait donc techniquement atteindre votre bucket. Nous ne pouvons pas honnêtement promettre le contraire ; ce que vous pouvez faire, c'est lui donner une clé limitée à **ce seul bucket**, sans rien d'autre dedans, et la remplacer quand vous voulez (**Enregistrer et essayer** avec la nouvelle).
- **Votre fournisseur** garde les fichiers, selon ses propres conditions. Gardez le bucket privé : Songverse n'a jamais besoin qu'il soit public.

## Ce qui est à votre charge

Une fois votre bucket connecté, son contenu est sous votre responsabilité :

- **Les sauvegardes.** Les sauvegardes de ce serveur ne copient pas votre bucket. Gardez-en une copie ailleurs, par exemple avec [rclone](https://rclone.org/) à intervalles réguliers vers un autre fournisseur ou une autre région, et essayez une fois de restaurer depuis elle.
- **Les versions et les suppressions.** Songverse ne modifie jamais un fichier en place : il en ajoute, et supprime ceux qu'aucun chant n'utilise plus (et ceux qu'il ramène). Activer les versions, ou garder les fichiers supprimés quelques jours, chez votre fournisseur vous protège d'une erreur. Cloudflare R2 ne garde pas de versions : comptez plutôt sur votre copie.
- **La clé.** Ne la partagez pas, ne l'utilisez nulle part ailleurs, et remplacez-la si vous pensez qu'elle a fuité.
- **Payer la facture.** Si le fournisseur arrête le bucket, Songverse ne peut plus ouvrir vos fichiers : les nouveaux sont gardés sur ce serveur en attendant, mais ceux déjà dans le bucket restent hors d'atteinte jusqu'à ce qu'il réponde à nouveau.
- **Partir.** Utilisez **Arrêter de l'utiliser**, pas la console du fournisseur : cela ramène chaque fichier sur ce serveur avant de déconnecter. Supprimer le bucket d'abord les fait perdre.

Une [sauvegarde de l'organisation](/fr/backups/) contient aussi les fichiers de ses équipes, où qu'ils soient gardés : téléchargez-en une de temps en temps.

## Le mettre en place

Quel que soit le fournisseur : créez un bucket **privé** qui ne sert qu'à cela, et une clé qui ne peut **que lire et écrire ce bucket**. Puis, sur la page de votre organisation, sous **Stockage propre**, remplissez le **Fournisseur**, son **ID du compte** ou sa **Région**, le **Bucket**, l'**ID de clé d'accès** et la **Clé d'accès secrète**, et **Enregistrer et essayer** : cela écrit, relit et supprime un petit fichier, et ne garde les réglages que si cela marche.

### Cloudflare R2

1. Dans le tableau de bord Cloudflare, ouvrez **R2 Object Storage** et **Create bucket**. Donnez-lui un nom ; l'emplacement peut rester automatique.
2. Copiez votre **Account ID**, affiché sur la page d'accueil de R2.
3. Sous **Manage API tokens**, créez un jeton d'API avec la permission **Object Read & Write**, appliqué à **ce seul bucket**.
4. Copiez l'**Access Key ID** et la **Secret Access Key** qu'il affiche (la secrète une seule fois).

### Amazon S3

1. Dans la console S3, **Create bucket** dans la région voulue (comme `eu-central-1`), en gardant **Block all public access** activé.
2. Dans IAM, créez un utilisateur pour Songverse, sans accès à la console, et donnez-lui une stratégie qui n'autorise que `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` et `s3:ListBucket` sur ce bucket :

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::votre-bucket" },
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::votre-bucket/*" }
     ]
   }
   ```

3. Créez une **clé d'accès** pour cet utilisateur (pour une application qui tourne hors d'AWS) et copiez ses deux parties.
4. Dans Songverse, la **Région** est celle du bucket, comme `eu-central-1`. Activer **Bucket Versioning** permet de récupérer les fichiers supprimés.

### Backblaze B2

1. Sous **Buckets**, **Create a Bucket**, avec **Files in Bucket** sur **Private**.
2. Son **Endpoint** ressemble à `s3.us-west-004.backblazeb2.com` : la **Région** est la partie du milieu, `us-west-004`.
3. Sous **Application Keys**, **Add a New Application Key** avec accès à **ce seul bucket**, en **Read and Write**.
4. Copiez le **keyID** (l'**ID de clé d'accès**) et l'**applicationKey** (la **Clé d'accès secrète**, affichée une seule fois). B2 garde les anciennes versions par défaut ; ses règles de cycle de vie disent combien de temps.

### Wasabi

1. **Create Bucket** dans la région voulue (comme `eu-central-1`).
2. Sous **Policies**, créez une stratégie qui n'autorise que lire, écrire, supprimer et lister dans ce bucket (la même que celle d'Amazon S3 ci-dessus).
3. Sous **Users**, créez un utilisateur avec accès programmatique, attachez-lui cette stratégie, et copiez sa clé d'accès et sa clé secrète.
4. Dans Songverse, la **Région** est celle du bucket. Wasabi facture une durée minimale pour chaque fichier gardé, même supprimé : vérifiez ses tarifs.

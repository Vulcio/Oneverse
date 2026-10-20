---
title: Votre propre serveur de séparation
description: Installer Songverse Sonic avec Docker ou sur Proxmox, et le connecter à votre équipe ou votre organisation.
---

Songverse sépare les enregistrements en pistes (voir [Séparer un enregistrement en pistes](/fr/library/#séparer-un-enregistrement-en-pistes)) sur un serveur **Songverse Sonic** : Demucs, qui fait la séparation, et une analyse de chaque enregistrement - son tempo, ses temps et ses mesures, sa tonalité et ses sections. Une équipe ou une organisation peut avoir le sien, sur son propre ordinateur ou serveur, et le connecter. Ses chants y sont alors séparés, par ses membres, sans qu'il faille un rôle donné par l'admin de ce Songverse.

## Avant de commencer

- **Ce Songverse le permet.** Son admin active **Les équipes et les organisations peuvent connecter leur propre serveur Songverse Sonic** dans Admin > Séparation en pistes. Sinon, la section **Séparation en pistes** n'apparaît pas sur la page d'une équipe ou d'une organisation.
- **Un ordinateur toujours allumé :** Linux avec Docker, ou un hôte Proxmox. Le processeur suffit (quelques minutes par chant) ; une carte graphique NVIDIA est bien plus rapide. Comptez 8 Go de mémoire et 10 Go de disque pour les modèles et les tâches.
- **Songverse peut le joindre :** une adresse publique commençant par https://, en général derrière un proxy inverse. Une adresse privée ou locale (`http://192.168.1.20:8000`) ne fonctionne que si l'admin de ce Songverse l'autorise (**Aussi sur des adresses privées ou locales**), ce qui n'a de sens que si les deux serveurs sont sur le même réseau.

## Avec Docker

```bash
docker run -d --name sonic --restart unless-stopped -p 8000:8000 \
  -e DEMUX_API_KEY="$(openssl rand -hex 32)" \
  -e DEMUX_PRELOAD_MODELS="htdemucs htdemucs_ft" \
  -v sonic-data:/var/lib/demucs-api \
  ghcr.io/bricedupuy/songverse-sonic:latest
```

- **Sa clé d'API**, à coller dans Songverse : `docker exec sonic printenv DEMUX_API_KEY`.
- **Avec une carte graphique NVIDIA :** l'image `ghcr.io/bricedupuy/songverse-sonic:cuda`, avec `--gpus all` (le NVIDIA container toolkit doit être installé). Sans carte utilisable, il le dit dans son journal et utilise le processeur.
- **Docker Compose :** le dépôt contient un `docker-compose.yml` et un `.env.example` à copier.
- **Mettre à jour :** `docker pull` l'image et recréer le conteneur ; les tâches et les modèles restent dans le volume `sonic-data`.

Tous les réglages sont dans le [dépôt de Songverse Sonic](https://github.com/bricedupuy/songverse-sonic).

## Sur Proxmox

Sur l'hôte Proxmox, en root :

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/bricedupuy/songverse-sonic/main/ct/demucs-api.sh)"
```

Il crée un conteneur Debian qui fait tourner Songverse Sonic, avec un choix guidé entre processeur et carte graphique. Sa clé d'API : `pct exec <CTID> -- cat /etc/demucs-api/api-key`. Dans le conteneur, `update` le met à jour.

## Le rendre joignable

Placez-le derrière un proxy inverse qui lui donne une adresse en https://. Avec Caddy, par exemple :

```text
sonic.example.org {
  reverse_proxy localhost:8000
}
```

Indiquez-lui ensuite son adresse publique et de faire confiance au proxy : `DEMUX_PUBLIC_BASE_URL=https://sonic.example.org`, `DEMUX_TRUST_PROXY_HEADERS=true` et `DEMUX_FORWARDED_ALLOW_IPS` avec l'adresse du proxy. Sonic prévient Songverse quand les pistes sont prêtes ; s'il ne peut pas joindre Songverse, Songverse le lui demande toutes les 2 minutes.

## Le connecter

Sur la page de l'équipe - ou de l'organisation - ses admins trouvent **Séparation en pistes** :

- **Adresse du serveur** et **Clé d'API**, puis **Connecter** ;
- **Puis une passe plus fine** : une séparation plus lente et meilleure qui remplace les premières pistes quand le serveur a le temps ;
- **Séparations par personne sur 30 jours** : vide pour aucune limite.

**Tester la connexion** vérifie l'adresse et la clé : **Connecté : songverse-sonic 1.6.0. Modèles : …**. Si sa version ne trouve pas les temps et les mesures, il dit de la mettre à jour. La clé n'est plus jamais affichée : laissez-la vide pour la garder. **Déconnecter** arrête d'utiliser le serveur : ce qui y était encore en cours de séparation échoue, et les pistes déjà séparées restent.

## Quel serveur pour quel chant

- **Un chant d'une équipe :** le serveur de l'équipe, sinon celui de son organisation, sinon celui de ce Songverse, s'il en a un.
- **Vos propres chants :** le serveur de ce Songverse.
- **Qui peut séparer :** sur le serveur d'une équipe ou d'une organisation, les membres de l'équipe, dans sa limite. Sur celui de ce Songverse, ceux que son admin a autorisés.

Quand vous séparez un enregistrement, la fenêtre nomme le serveur où il part : **Sur le serveur Sonic de Grace Church**.

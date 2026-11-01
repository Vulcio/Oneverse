---
title: Your own storage
description: Keep your organisation's files in your own bucket - what it changes, who can see them, what's yours to look after, and how to set it up at each provider.
---

An organisation can keep its teams' songs' files - recordings, stems, PDFs and the other attachments - in a bucket of its own instead of on this server. This page says what that changes and how to set it up; [Its own storage](/organizations/#its-own-storage) says how the **Own storage** card works.

It needs this server's admin to allow it (**Organisations may use their own storage**) and one of your roles to allow **Own storage for organisations**: until then, the card says who to ask.

## Why use it

- **Your space:** as much as you pay for, rather than what this server gives your teams. Under **Defaults** you set your own limits - per team, per person, the largest file - and your own roles can give some people more (see [Its own roles](/organizations/#its-own-roles)).
- **Your bill:** the provider bills you directly for what you keep and send. Cloudflare R2 doesn't charge for downloads, which suits recordings played often.
- **Your files, where you choose:** in the region you pick, under your own account, which you can leave by stopping it (everything comes back to this server first).

## Who can see your files

- **In Songverse,** only those who can open a song open its files, as before: its team's members and those it's shared with. This server's admins don't see your bucket in the app, and nobody can browse it through Songverse.
- **The server keeps your key.** To store your files and send them to your members, this server keeps your bucket's key, encrypted. So whoever runs this server - its admins, and its hosting - could technically reach your bucket. We can't honestly promise otherwise; what you can do is give it a key for **that bucket only**, with nothing else in it, and replace the key whenever you like (**Save and try it** with the new one).
- **Your provider** holds the files, under its own terms. Keep the bucket private: Songverse never needs it public.

## What's yours to look after

Once your bucket is connected, what's in it is your responsibility:

- **Backups.** This server's own backups don't copy your bucket. Keep a copy elsewhere, for example with [rclone](https://rclone.org/) on a schedule to another provider or another region, and try restoring from it once.
- **Versions and deletion.** Songverse never changes a file in place: it adds new ones, and deletes those no song uses any more (and those it moves back). Turning on versioning, or keeping deleted files for some days, at your provider protects you from a mistake. Cloudflare R2 doesn't keep versions: rely on your copy instead.
- **The key.** Don't share it, don't use it anywhere else, and replace it if you think it leaked.
- **Paying the bill.** If the provider stops the bucket, Songverse can't open your files: new ones are kept on this server meanwhile, but those already in the bucket stay out of reach until it answers again.
- **Leaving.** Use **Stop using it**, not the provider's console: it brings every file back to this server before disconnecting. Deleting the bucket first loses them.

A [backup of the organisation](/backups/) also holds its teams' files, wherever they're kept: download one now and then.

## Setting it up

Whatever the provider: make a **private** bucket used only for this, and a key that can **only read and write that bucket**. Then, on your organisation's page, under **Own storage**, fill in the **Provider**, its **Account ID** or **Region**, the **Bucket**, the **Access key ID** and the **Secret access key**, and **Save and try it**: it writes, reads back and deletes a small file, and keeps the settings only if that works.

### Cloudflare R2

1. In the Cloudflare dashboard, open **R2 Object Storage** and **Create bucket**. Give it a name; the location can stay automatic.
2. Copy your **Account ID**, shown on the R2 overview page.
3. Under **Manage API tokens**, create an API token with **Object Read & Write** permission, applied to **this bucket only**.
4. Copy the **Access Key ID** and **Secret Access Key** it shows (the secret only once).

### Amazon S3

1. In the S3 console, **Create bucket** in the region you want (such as `eu-central-1`), keeping **Block all public access** on.
2. In IAM, create a user for Songverse, with no console access, and give it a policy that only allows `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` on this bucket:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::your-bucket" },
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::your-bucket/*" }
     ]
   }
   ```

3. Create an **access key** for that user (for an application running outside AWS) and copy both parts.
4. In Songverse, the **Region** is the bucket's, such as `eu-central-1`. Turning on **Bucket Versioning** keeps deleted files recoverable.

### Backblaze B2

1. Under **Buckets**, **Create a Bucket**, with **Files in Bucket** set to **Private**.
2. Its **Endpoint** looks like `s3.us-west-004.backblazeb2.com`: the **Region** is the part in the middle, `us-west-004`.
3. Under **Application Keys**, **Add a New Application Key** allowed access to **this bucket only**, with **Read and Write**.
4. Copy the **keyID** (the **Access key ID**) and the **applicationKey** (the **Secret access key**, shown only once). B2 keeps old versions by default; its lifecycle settings say for how long.

### Wasabi

1. **Create Bucket** in the region you want (such as `eu-central-1`).
2. Under **Policies**, create a policy allowing only reading, writing, deleting and listing in this bucket (the same as Amazon S3's above).
3. Under **Users**, create a user with programmatic access, attach that policy, and copy its access key and secret key.
4. In Songverse, the **Region** is the bucket's. Wasabi bills a minimum time for each file kept, even after it's deleted: check its pricing.

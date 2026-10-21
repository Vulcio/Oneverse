-- Sign in with Oneverse (issue #303): passkeys are added and used at
-- Oneverse, whose domain is their relying party. Those made for Songverse's
-- domain won't work there: everyone adds theirs again from Oneverse's account page.
DELETE FROM "Passkey";

# Accounts live in the API; every app signs in through Oneverse

Sign-in moved from Songverse's web server into the API (BetterAuth mounted in `apps/api`), and since #303 people sign
in at Oneverse while Songverse, Oneverse Plan and the operator console are OAuth clients, each with its own session.
With native apps on the roadmap, every client authenticates against one backend instead of each web app being an
auth surface of its own. Consequence: no web app touches the database; everything goes through the API.

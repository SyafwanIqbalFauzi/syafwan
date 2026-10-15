# syafwan

The source of **[syafwan.com](https://syafwan.com)**: my personal website, plus a private dashboard
for the AI assistants I run.

It has two parts.

## 1. Personal website

A bilingual (English / Bahasa Indonesia) portfolio:

- **Work**: products and client projects I have built or led
- **About**: experience, skills and how I work
- **Writing**: articles on product management, agile and applied AI

All content lives in a CMS, so I can edit it without touching code, and changes show up on the
site within a minute.

## 2. Hermes dashboard

A private area of the site, only for me, behind a sign-in. It is the control room for
[Hermes](https://github.com/NousResearch/hermes-agent), the open-source AI agent that runs my
scheduled assistants.

From the dashboard I can:

- **Chat** with Hermes from the browser
- **See my agents**: what each one does, which model and skills it uses, when it runs next and
  what it produced the last time, grouped by project
- **Read the history of results** of every agent run, not only the latest message in a chat app
- **Run, pause or resume** an agent
- **Check the overview**: health, recent failures and what is coming up
- **Browse conversations** from the web, Telegram and Discord, and **keep an eye on usage**

The dashboard is not public and the repository contains no credentials or private data.

## Built with

- [Astro](https://astro.build) for the website and dashboard
- [Directus](https://directus.io) as the CMS
- Docker for running everything
- GitHub Actions for building and publishing

The design follows the clean, thin-type look of [teenage.engineering](https://teenage.engineering).

## Repository

```
web/       the website and the dashboard
cms/       CMS setup (data model and helper scripts)
scripts/   small helper scripts, including the one that syncs agent results
```

## Running it locally

You need Node 22+ and Docker.

```bash
cp .env.example .env     # then fill in your own values
npm install
npm run cms:up           # start the CMS
npm run dev              # open http://localhost:4321
```

The public website works with just this. The dashboard also needs a running Hermes instance, so
it will show empty pages without one.

## Author

Syafwan Iqbal Fauzi · [syafwan.com](https://syafwan.com)

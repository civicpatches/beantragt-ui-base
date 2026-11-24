# beantragt.ai citizen portal and casework interface

English · [Deutsch](README.de.md)

beantragt.ai is a platform for municipal online applications. The citizen portal contains forms for submitting applications. Municipal staff use the casework interface to manage applications, deadlines, requests for additional information and decision notices generated from templates.

This repository contains the open Nuxt interface, including the citizen portal, form catalogue, application submission and casework. The interface requires the open Drupal backend [beantragt](https://github.com/civicpatches/beantragt) from the same release. Both components are started together through the self-hosting package in the backend repository.

beantragt.ai has not reached version 1.0 yet. Interfaces, data model and configuration may still change between releases.

[Self-hosting with Docker Compose](https://github.com/civicpatches/beantragt/blob/main/deploy/selfhost/README.md)

## Development

Development uses the pnpm version specified in `package.json`. The `.env.example` file is copied to `.env` and the base URLs are configured. Dependencies are installed with `pnpm install --frozen-lockfile`. The interface is started with `pnpm dev`. The `pnpm check:layers` command checks source boundaries. The `pnpm build:casework` command also checks the casework build and its output.

## Operation and responsibility

The operator decides how the software is used and is responsible for its configuration and the processing of personal data. The backend self-hosting guide describes the configuration for production operation.

## License and attribution

The code from Civic Patches GmbH is licensed under AGPL-3.0-only with additional terms under § 7(b) and § 7(c). Under § 7(b), portals using this interface or a modified version retain the attribution notice “Contains software from beantragt.ai. Civic Patches GmbH is the licensor of the material concerned (https://civic-patches.de)” in the legal notices, for example on a legal information or license page. Presentation and placement are flexible. A footer link is optional. Under § 13 AGPL, users of a modified version run over a network are given access to the source code of the version in use. The citizen portal and casework interface provide a “Source code” link for this purpose. Its destination is set through `NUXT_PUBLIC_SOURCE_URL`.

Details are available in [LICENSE](LICENSE), [NOTICE](NOTICE) and [TRADEMARKS.md](TRADEMARKS.md).

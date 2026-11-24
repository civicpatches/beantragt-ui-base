# Herkunft der veröffentlichten UI-Komponenten

Die jeweiligen Lizenz- und Urheberhinweise stehen in den mitgelieferten Dateien und in `NOTICE`. Mark-a-Spot ist ein Open-Source-Projekt derselben Herausgeberin.

| Bestandteil | Herkunft |
| --- | --- |
| Druck, Einbetten, Fehlerbehandlung und Anfragebegrenzung | Aus Mark-a-Spot übernommen oder angelehnt: `app/assets/css/print.css`, `useEmbed.ts`, `useApiErrorMessage.ts`, `useErrorHandler.ts` und `server/utils/rate-limit.ts`. |
| Rechtliche Inhaltsseite | Regeln aus `LegalPageLayout.vue` von Mark-a-Spot, umgesetzt in `PublicContentPage.vue`. |
| Statistikkacheln | `StatTiles.vue` folgt den Statuskacheln von Mark-a-Spot. |
| FIM-Katalog, Konverter und Abruf | Datenquelle FITKO. Der Konverter legt eigene FormSchema-Entwürfe an. |
| Nuxt-UI-Theme | Sechs Übernahmen unter MIT. Revision, Prüfsummen und Originalhinweis stehen in `app/utils/theme/NOTICE.md`. |
| Schrift und Icons | Hanken Grotesk unter OFL-1.1. Lucide unter ISC mit ausgewiesenen Feather-Übernahmen unter MIT. |

FIM-Katalogdaten und Schemata werden gesondert bezogen. Weitere Angaben zu Paketlizenzen stehen in `THIRD-PARTY-NOTICES.md`.

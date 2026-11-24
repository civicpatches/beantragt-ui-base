# beantragt.ai Bürgerportal und Sachbearbeitung

[English](README.md) · Deutsch

beantragt.ai ist eine Plattform für kommunale Online-Anträge. Das Bürgerportal enthält Formulare für die Antragstellung. In der Sachbearbeitung verwaltet die Verwaltung Anträge, Fristen, Nachforderungen und Bescheide aus Vorlagen.

Dieses Repository enthält die offene Nuxt-Oberfläche mit Bürgerportal, Formularkatalog, Antragstellung und Sachbearbeitung. Die Oberfläche benötigt das offene Drupal-Backend [beantragt](https://github.com/civicpatches/beantragt) derselben Release-Version. Beide Komponenten werden gemeinsam über das Paket für den Eigenbetrieb im Backend-Repository gestartet.

beantragt.ai hat Version 1.0 noch nicht erreicht. Schnittstellen, Datenmodell und Konfiguration können sich zwischen Releases noch ändern.

[Eigenbetrieb mit Docker Compose](https://github.com/civicpatches/beantragt/blob/main/deploy/selfhost/README.de.md)

## Entwicklung

Für die Entwicklung wird die in `package.json` angegebene pnpm-Version verwendet. Die Datei `.env.example` wird nach `.env` kopiert und die Basis-URLs werden gesetzt. Die Abhängigkeiten werden mit `pnpm install --frozen-lockfile` installiert. Die Oberfläche wird mit `pnpm dev` gestartet. `pnpm check:layers` prüft die Quellgrenzen. `pnpm build:casework` prüft zusätzlich den Casework-Build und dessen Ausgabe.

## Betrieb und Verantwortung

Über den Einsatz entscheidet der Betreiber. Er verantwortet die eingesetzte Konfiguration und die Verarbeitung personenbezogener Daten. Die Betriebsanleitung des Backends beschreibt die Konfiguration für den Produktivbetrieb.

## Lizenz und Herkunft

Der Code der Civic Patches GmbH steht unter AGPL-3.0-only mit Zusatzbestimmungen nach § 7(b) und § 7(c). Nach § 7(b) bleibt in Portalen, die diese Oberfläche oder eine Bearbeitung davon einsetzen, der Herkunftshinweis „Enthält Software aus beantragt.ai; Lizenzgeberin des betreffenden Materials: Civic Patches GmbH (https://civic-patches.de)“ in den rechtlichen Angaben erhalten, etwa im Impressum oder auf einer Lizenzseite. Gestaltung und Platzierung sind frei. Ein Link im Footer ist freiwillig. Bei veränderten Fassungen im Netzbetrieb wird den Nutzenden der Quellcode der eingesetzten Fassung zugänglich gemacht (§ 13 AGPL). Dafür ist der Link „Quellcode“ in Portal und Sachbearbeitung vorgesehen. Sein Ziel wird über `NUXT_PUBLIC_SOURCE_URL` eingestellt.

Einzelheiten stehen in [LICENSE](LICENSE), [NOTICE](NOTICE) und [TRADEMARKS.md](TRADEMARKS.md).

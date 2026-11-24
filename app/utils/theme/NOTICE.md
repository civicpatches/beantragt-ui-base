# Third-party notice: Nuxt UI theme engine

The files below are copies from the repository https://github.com/nuxt/ui, branch `v4`, commit `f4f284c6c6d5c4c3087f76b7bfb4b0bb3621cdd7` (2026-11-09). They were fetched read-only on 2026-11-13 with the owner's approval and copied here for the theme contract (`darstellung-vertrag.md`, slice T1). The theme code is not a published API of the `@nuxt/ui` package; when upstream changes it, these copies are updated by hand.

| Copy | Original path | sha256 of the original | Changed against the original |
|---|---|---|---|
| `engine/types.ts` | `docs/app/utils/theme/engine/types.ts` | `da3fe38839dbdf6ee9196c778ce27e76812884842b5223a7fde8b80d2cd96b36` | nothing |
| `engine/palette.ts` | `docs/app/utils/theme/engine/palette.ts` | `7c650165ec2100838e5147667baef2615e837653185fd596901f326c4a12d285` | nothing |
| `engine/presets.ts` | `docs/app/utils/theme/engine/presets.ts` | `4ca41081d18df63cb9cf5dde6fa4675e9068d9867905ae1cf0d9745fed4dd927` | nothing |
| `engine/serialize.ts` | `docs/app/utils/theme/engine/serialize.ts` | `f8f16e14bf90d0117093cd4ab299aa4aa2331df316e53193b88160818fe81971` | line 19: `import json5 from 'json5'` became `import json5 from '../json5-stringify'` |
| `icons.ts` | `docs/app/utils/theme/icons.ts` | `a22c394557e5bf5b50403d6a1fb978ecb9b5690c8d490d3cfe3d75b0edad9d17` | line 1: `import lucide from '../../../../src/theme/icons'` became `import lucide from './nuxt-ui-icons'`, line 516: `pencil: 'i-lucide-pencil'` became `pencil: 'i-lucide-square-pen'` |
| `nuxt-ui-icons.ts` | `src/theme/icons.ts` | `99140cb7f47bd535ce4e19e0113ee54e173058f863c1c131198ca4195c75be56` | line 19: `edit: 'i-lucide-pencil'` became `edit: 'i-lucide-square-pen'` |

Each copy starts with a comment header (source, commit, licence, changed lines); apart from that header and the listed changes it is the original. `tests/unit/theme/theme-engine-copies.test.ts` checks this against the sha256 values above.

Not copied: `docs/app/utils/theme/engine/index.ts` (re-exports only), `engine/sections.ts` (the form sections of the theme picker on ui.nuxt.com; neither the serializer nor these tests use it) and `docs/app/utils/theme/studio.ts` (the picker's state; it adds a `<link>` to the document head to load fonts at runtime, which the contract forbids).

Our own files beside the copies, not from the repository: `json5-stringify.ts` (the one `json5` function the serializer uses), `current.ts` (today's look as a theme document).

## Licence

MIT License

Copyright (c) 2023 Nuxt

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

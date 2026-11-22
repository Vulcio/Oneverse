# Matt Pocock's skills (vendored)

The skills in this folder, apart from any this repository adds itself, are copied from
[mattpocock/skills](https://github.com/mattpocock/skills) at commit
`49dd158d1076134a641b33efb035946536778336` (plugin `mattpocock-skills` 1.3.1, the commit
Anthropic's official plugin marketplace pins). They are the 27 skills that plugin ships, such as
`/grill-with-docs`, `/grill-me`, `/tdd`, `/diagnosing-bugs`, `/to-spec` and `/to-tickets`.
Only the Codex-specific `agents/openai.yaml` files were left out.

They are copied rather than installed as a plugin because Claude Code cloud sessions don't install
plugins a repository's `.claude/settings.json` enables, but they do load the skills in the
repository's `.claude/skills/`. Don't also install the `mattpocock-skills` plugin on a computer that
works in this repository, or every skill shows up twice.

To update: copy the skill folders listed in that repository's `.claude-plugin/plugin.json` again
from the commit you want, and change the commit above.

## Licence

```
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

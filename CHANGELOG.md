# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Add on-device semantic search for saved summaries (#9) ([3f670f6](https://github.com/darshi1337/apogee/commit/3f670f6c5ad0529e06fbd6cea34732bf5c12bf48))
- Default to Opus translation engine and wire for Ollama (Closes #89) ([7586e44](https://github.com/darshi1337/apogee/commit/7586e44cd1e191f16d705c329626eb0cfca4d932))
- Add arXiv abstract extractor (#93) ([282a1cb](https://github.com/darshi1337/apogee/commit/282a1cb57614d57ebe9ffd030b739756e907add2))
- Add keyboard shortcut to open extension popup ([04981e5](https://github.com/darshi1337/apogee/commit/04981e55b2d7bec882acafa4a13722360a00fd32))
- Refactor host permissions to optional and enforce on-demand access (#94) ([206bec0](https://github.com/darshi1337/apogee/commit/206bec0df22a1c6fea829951b2e6dba5cc221946))
- Migrate domain permissions to optional_host_permissions and on-demand prompts (#115) ([de8f856](https://github.com/darshi1337/apogee/commit/de8f85643dd6f7aabbfd4739d030bfb30ed11573))
- Add Mastodon thread extractor (#31) ([a6dcfce](https://github.com/darshi1337/apogee/commit/a6dcfceb0517a63f48eafa2e3e2dcf5975dee546))
- Add multi-tab batch summarization via context menu (#116) ([58686aa](https://github.com/darshi1337/apogee/commit/58686aa54ac15051442651b518207d9f5f0ed34e))
- Add Stack Overflow question extractor ([5cfa34b](https://github.com/darshi1337/apogee/commit/5cfa34b093854d09642e6c787b75ba699c5ba6c5))
- Add Lemmy post extractor (#32) ([b221cef](https://github.com/darshi1337/apogee/commit/b221cefad1947a59e5e056abbc523f6fa8494df5))
- Add Discourse forum extractor (#33) ([65074ca](https://github.com/darshi1337/apogee/commit/65074ca348d71071aa72f6c7b4fcd373eada13e8))
- Enforce Shadow DOM encapsulation for content script overlays ([8c029f0](https://github.com/darshi1337/apogee/commit/8c029f013b2d43ede7dff220d19b5519e48384cf))
- Add llama.cpp client for llama-server ([4bf6548](https://github.com/darshi1337/apogee/commit/4bf65481247f3fce1b29689c7145f4c83c397381))
- Support llama-server's --api-key in the llama.cpp client ([36ae980](https://github.com/darshi1337/apogee/commit/36ae980e8e60224797ea3325a0d1ca1fa61e5371))
- Let a reported context window override the model-name guess ([3beb1df](https://github.com/darshi1337/apogee/commit/3beb1dfb17b5b67e2e9ef707e0c35f9756bd79b9))
- Add optional Chrome side panel ([f26b78f](https://github.com/darshi1337/apogee/commit/f26b78fd6294bfa6943e232f0aa36c5fc30ec308))
- Add sharp-cornered paste text and upload file quick action buttons ([8ce6807](https://github.com/darshi1337/apogee/commit/8ce6807105bdc49233dbe538464cc50dd371786f))
- Conditionally hide Open in side panel button when panel is open for tab ([685e8f8](https://github.com/darshi1337/apogee/commit/685e8f8ce42f8e0503e3950884841ac60ebfd37a))
- Bring on-device RAG retrieval and Q&A to Firefox (Fixes #99) ([ef83f78](https://github.com/darshi1337/apogee/commit/ef83f7862b72e41e24e02a81f2a32d7710ab2772))
- Add Activity & Privacy Audit View to verify local execution (Fixes #113) ([18eabc1](https://github.com/darshi1337/apogee/commit/18eabc14bdc9359f6a51527145be0db7a2f6d561))
- Register llama.cpp as a selectable provider ([b5cd826](https://github.com/darshi1337/apogee/commit/b5cd8263c433c666d2df522448fd1bed2127cd33))
- Route llama.cpp jobs through the service worker ([33385e3](https://github.com/darshi1337/apogee/commit/33385e37dfc2ff5b44460389f41793df3ede93c9))
- Add the llama.cpp provider to Settings ([3e0240a](https://github.com/darshi1337/apogee/commit/3e0240a296c4e5a6d5b89c2e337232ad55852144))
- Add plain-text summary export ([dd90692](https://github.com/darshi1337/apogee/commit/dd90692dc7f25e7189a991afaff8b196b3b12913))
- Show tokens/sec while a summary or answer streams ([c924292](https://github.com/darshi1337/apogee/commit/c924292ad872fd5688aaa57c7ddb328e115f9ce5))
- Improve summary and ask views ([5c3faf1](https://github.com/darshi1337/apogee/commit/5c3faf1ee5d935e9d8c2dcadf8f2a75809afc6d6))
- Support PDF and DOCX uploads ([dadc18c](https://github.com/darshi1337/apogee/commit/dadc18c70740ffe66ab554902a3e5f526429206c))
- Summarize selected text from shared UI ([6fdeef8](https://github.com/darshi1337/apogee/commit/6fdeef87ccd56f28ffc4e2214f49088e665f69cd))
- Add Bluesky thread extractor (#147) ([6c989bb](https://github.com/darshi1337/apogee/commit/6c989bbdd33bde9bf213cb7a99918382e1e82de3))
- Hierarchical map-reduce for long inputs (#148) ([1a9ec08](https://github.com/darshi1337/apogee/commit/1a9ec083a9da86e3eb19f50a1a696a8bebeaf340))
- Add JSON export for summaries ([7e105bf](https://github.com/darshi1337/apogee/commit/7e105bf6d94b7dd0d46417e3860d33c889e72359))
- Polish summary export and past-summaries actions ([9e314af](https://github.com/darshi1337/apogee/commit/9e314af5aa34d07951ad991c8e93dc7d1f705138))
- Add GitLab issue and merge request extractor ([2e8baf2](https://github.com/darshi1337/apogee/commit/2e8baf2fb6fb6377131c6555fdac849f3a6fea02))
- Route GitLab pages through extractor ([d5d57ea](https://github.com/darshi1337/apogee/commit/d5d57ea6e7c56b23787499789b698d8cd33a1ab3))
- Inject GitLab extractor ([bf94a7c](https://github.com/darshi1337/apogee/commit/bf94a7c2aa564443fe3c4b1b0f70095728d0bf3d))
- Add Dev.to article extractor (#169) ([64e2f3d](https://github.com/darshi1337/apogee/commit/64e2f3d665b5532c38788e4cd5950a54984c5c1a))

### Fixed

- Prettier issues ([64c6553](https://github.com/darshi1337/apogee/commit/64c65537e68d792edb5fe171af7c4ef3471fc822))
- Prettier issues ([715492e](https://github.com/darshi1337/apogee/commit/715492efacf405a7394556d762b1798b2ba2d599))
- Include translation engine in cached output identity (#100) ([71c67b3](https://github.com/darshi1337/apogee/commit/71c67b3b5c382fda4ef7d9548b3e962f9fb85fd3))
- Resolve CodeQL alerts for URL schemes, hostname regex, and markdown sanitization ([26485bb](https://github.com/darshi1337/apogee/commit/26485bbb649d3d4f3bf0bb24d99d7e56d0c95f65))
- Restore completed summaries after stream expiry ([49b3b2b](https://github.com/darshi1337/apogee/commit/49b3b2bac7bb8601cb1d76cdc80fb2e143011d05))
- Pretteir issues ([a91dccb](https://github.com/darshi1337/apogee/commit/a91dccbe06e3bed24e7ee0f42c9b96fef06b453f))
- OOM recovery and cancellation handling on large documents (#114) ([6ad4324](https://github.com/darshi1337/apogee/commit/6ad4324924156512ce45683ba15bde6200f22154))
- Clean up unused variables in extensionApiMock helper ([b0af026](https://github.com/darshi1337/apogee/commit/b0af026b884c0459b93151a23a7785895991ed89))
- Assert permissions in manifest.test.js to fix unused variable warning ([13cd817](https://github.com/darshi1337/apogee/commit/13cd8179b40e09d300c4ed9d0b9ba052e9584cb3))
- Correct which llama-server endpoints --api-key guards ([6fc6982](https://github.com/darshi1337/apogee/commit/6fc69826f33794a3a8a3d82d7282c0a9091c92fb))
- Release the response body when a llama.cpp stream ends early ([fcdbf96](https://github.com/darshi1337/apogee/commit/fcdbf96bd289dfc6f6406918683c0f2e43d32aa8))
- Resolve lint issue and update startLocalHttpStream call ([bd8ffee](https://github.com/darshi1337/apogee/commit/bd8ffee712a3b5daf694bed1fe2227c0df20afaa))
- Use port connection lifecycle to reliably detect active side panel state ([c8ba4b5](https://github.com/darshi1337/apogee/commit/c8ba4b57ab70c33b202fb8c7045c7d9960858f01))
- Keep user-facing error messages intact across the stream port ([2ec337a](https://github.com/darshi1337/apogee/commit/2ec337a953c03ad13a277da7c91697600adab270))
- Remove duplicate startLocalHttpStream call for LOCAL provider (#151) ([bc31fc9](https://github.com/darshi1337/apogee/commit/bc31fc92b9ff1219cc750b61e82a32a5fd3fabce))
- Route multi-tab summarize through the correct provider (#152) ([ea8ddfc](https://github.com/darshi1337/apogee/commit/ea8ddfc227bddb6ef6be68ac3bdab5b923bacb62))
- Popup ui transfering to side-panel ([88bb32f](https://github.com/darshi1337/apogee/commit/88bb32fa96bf300aa8ca630c598e28512e1b102e))
- Migrate from deleted chrome-webstore-upload-action to chrome-webstore-upload-cli@4 (API v2) ([2b5aeaf](https://github.com/darshi1337/apogee/commit/2b5aeaf7684d14f1b5455f9038471dd4c83470ee))
- Give an actionable message when a loopback host fails validation ([3b7252c](https://github.com/darshi1337/apogee/commit/3b7252c981e282af39cdcb85023589f052a0114e))
- Polish Bluesky extractor dispatch and score mapping ([72f6329](https://github.com/darshi1337/apogee/commit/72f6329c321501702fd05cdab7ad4a7ebc22c126))
- Handle post-OOM oversized final reduce and clarify fanIn ([a268445](https://github.com/darshi1337/apogee/commit/a26844513b7a2e203183d7bc9b4e2d1f95e2305e))
- Remove stray trailing true; statement in content.js ([551b153](https://github.com/darshi1337/apogee/commit/551b153a42abb3de13a3e59e9573384d2b79ceb0))
- Remove vulnerable image-size override (#189) ([341acca](https://github.com/darshi1337/apogee/commit/341accabd2bff553d8c487588a8f598fee48ad9b))
- Remove redundant shell-quote override (#190) ([6f2081b](https://github.com/darshi1337/apogee/commit/6f2081b72d6ff198fc2d6dcdac40e4de5091a50a))
- Fail closed when dev mock guard cannot be stripped ([ac444c4](https://github.com/darshi1337/apogee/commit/ac444c4e138ca43c59d4c4652fee3c13a518c804))
- Close undisclosed github api egress and sensitive audit logging (fixes #180, fixes #181) ([0d03d5a](https://github.com/darshi1337/apogee/commit/0d03d5a8ec53c79fedd782eb869ead37bd5d7dbd))
- Use exact-hostname egress assertions to satisfy CodeQL ([772b512](https://github.com/darshi1337/apogee/commit/772b512ef16f513774e2655e90a76e1ee36ae0f7))
- Add delete button for past summaries ([dd24feb](https://github.com/darshi1337/apogee/commit/dd24feb411630af2c21053980e698db081a0c9c3))
- Polish past-summary delete for collapsed and expanded cards ([9d64517](https://github.com/darshi1337/apogee/commit/9d6451738d70c737d6eb8aea2f722191124fb18b))
- Fence prompt titles and urls, lock documented permissions (fixes #182, fixes #183) ([daf85b3](https://github.com/darshi1337/apogee/commit/daf85b3d4a7dfd21156d6bef641753cb09bc568f))
- Cap upload file sizes, bound docx/pdf extraction, align youtube egress docs (fixes #184, fixes #185) ([316e5ae](https://github.com/darshi1337/apogee/commit/316e5ae78b61bdd42832b40fc841839effb92f94))
- Quick wins for audit findings (fixes #203, fixes #204, fixes #207, fixes #208, fixes #209) ([f73841f](https://github.com/darshi1337/apogee/commit/f73841f96a39195081b599e7b5ec9029d9d4a75f))
- Redact JSON api keys in logs ([bedf40d](https://github.com/darshi1337/apogee/commit/bedf40daca017e34bac6521499f1b0a11326c554))
- Redact diagnostic extra values ([5c5a140](https://github.com/darshi1337/apogee/commit/5c5a140010a9f0d1929282a483164b1aa8c7e04b))
- Preserve credential syntax while redacting ([22e96c4](https://github.com/darshi1337/apogee/commit/22e96c4a72055cf52e9fab04c55d104f4610a653))
- Redact sensitive diagnostic extras ([1017292](https://github.com/darshi1337/apogee/commit/1017292c03a043022ddf12ea019c95b33781a740))
- Preserve existing API key diagnostics redaction ([33765d9](https://github.com/darshi1337/apogee/commit/33765d9a01144641500a1c825d8a526fc9dcad0c))
- Format diagnostics utility ([8be3902](https://github.com/darshi1337/apogee/commit/8be39024e87a547c60988a724610a56ef9743f3b))
- Tighten credential-key matching, cover password, drop lock churn ([4f73b79](https://github.com/darshi1337/apogee/commit/4f73b796bd11ebc228c23b935adff8e6f272ddf7))
- Format GitLab extractor ([6f4cd9e](https://github.com/darshi1337/apogee/commit/6f4cd9e3cb3b8fcb71bf905a2d9383b30ff46a7a))
- Register GitLab extractor globals ([316bb14](https://github.com/darshi1337/apogee/commit/316bb14c79d99e10bd0710865c564364f91b79ab))
- Review nits on GitLab extractor ([47c9808](https://github.com/darshi1337/apogee/commit/47c98080651c357e25532cac2b49f5e2ff471e24))
- Gate Bluesky fetch behind optional-host permissions; harden markdown renderer ([0c97639](https://github.com/darshi1337/apogee/commit/0c976395bf8d9369e78ffd6b3abd89c2de841fa0))
- Document Reddit same-origin .json fetch; add extractor egress parity test ([858ddba](https://github.com/darshi1337/apogee/commit/858ddbac03b21590b2431d432223eb9dc0d9b454))
- Fence question, custom instructions, and translate text in prompts ([5e83d6d](https://github.com/darshi1337/apogee/commit/5e83d6d76bf27c341cd078aac6c20156f02acb77))
- Fail closed when chrome.permissions API is absent ([ca56f0c](https://github.com/darshi1337/apogee/commit/ca56f0c2e9d938cf31ba8828f0ebede86da25fc5))
- Share one validator across service worker and diagnostics ([58cd217](https://github.com/darshi1337/apogee/commit/58cd217aae638e5f3cf78da8326be57aef372a63))
- Cap pasted-text and plain-text file inputs ([61dffec](https://github.com/darshi1337/apogee/commit/61dffeccd72ac44e72bc32e2aa3a0322e35d2de5))
- Render stored summaries without clickable links ([97b799a](https://github.com/darshi1337/apogee/commit/97b799a106363f16111b9257c5eea14c2b3471e3))
- Sanitize page-controlled YouTube chapter titles in brief prompt ([fbd4f68](https://github.com/darshi1337/apogee/commit/fbd4f683c6b364f11ce65a84f6be3d427eef1fe6))
- Validate llama host in UI with shared loopback validator ([abb1b7e](https://github.com/darshi1337/apogee/commit/abb1b7ef9f6f14dd3ef10fb8112cae6d002f59e7))
- Tolerate undefined sender in onMessage guards ([2dde61d](https://github.com/darshi1337/apogee/commit/2dde61dca665c38e6c2e0c6beff500e7665cedb6))
- Reject tab-originated messages in offscreen handler ([dfd8e44](https://github.com/darshi1337/apogee/commit/dfd8e446a45a59753fc0ec3ac8eeb7a39ac92160))
- Validate port.sender in onConnect handlers ([00f199d](https://github.com/darshi1337/apogee/commit/00f199d8f831e8a66869086ee1fbeb9857d549e7))
- Strict sender reject in popup listeners ([8ea5090](https://github.com/darshi1337/apogee/commit/8ea5090868afc14de41304e301d9cdc841ae0170))
- Strict sender reject in content-script listener ([bf91d69](https://github.com/darshi1337/apogee/commit/bf91d69e7ad5fd907240766b7f3d8d11f6c91ab2))
- Reject tab-originated ports in offscreen onConnect ([d303b19](https://github.com/darshi1337/apogee/commit/d303b19249cf3dc90d7b0a0bdb70b08fe6d23dfe))
- Reject tab-originated ports in service-worker onConnect ([f298752](https://github.com/darshi1337/apogee/commit/f2987528877f24b428917f9055c7b6a7d0baac95))
- Strict sender + tab reject in highlight listener ([3da75b1](https://github.com/darshi1337/apogee/commit/3da75b16a777e5ba1ab1894965e790c92773a11b))
- Reject tab-originated messages in popup listeners ([c5eaf5d](https://github.com/darshi1337/apogee/commit/c5eaf5d076460b4ff5135ca52100911b419be319))
- Reject tab-originated messages in content listener ([2fbf523](https://github.com/darshi1337/apogee/commit/2fbf5239dbd203ac56be4c0d39d91f35e171b879))
- Validate host in direct provider constructors ([caf98ea](https://github.com/darshi1337/apogee/commit/caf98ea9ce61d6dabf4622509ee44d782c8fe234))
- Cap stream-finished text at finalize boundary ([6272420](https://github.com/darshi1337/apogee/commit/6272420073813fba4e4ec00935f49d6b072715ed))
- Cap llamaModel free-text input ([2af27dc](https://github.com/darshi1337/apogee/commit/2af27dc302193cada20b9ad0a0e403ebc677f209))
- Schema-validate settings on read ([18895e6](https://github.com/darshi1337/apogee/commit/18895e66dedd6e2c7e6ec99888c3f3a9432af8a1))
- Show upload only in side panel ([939d315](https://github.com/darshi1337/apogee/commit/939d3155bb49ceb5bcd0f9a0bbfd290b9aea5db9))
- Make empty-content summarize branches throw instead of silently returning ([bf569a5](https://github.com/darshi1337/apogee/commit/bf569a5b54de514bac4f55b77bdcfdeccc6ccf86))
- Accessibility pass on the landing page (#240) ([76de301](https://github.com/darshi1337/apogee/commit/76de301c31ab18318843188e319da92766934c94))

### Security

- Harden log sanitization, session cookies, host validation, and notification targets (fixes #129, fixes #130, fixes #131, fixes #132) ([82f970e](https://github.com/darshi1337/apogee/commit/82f970e56d6b6883617f6596470689341667cac4))
- Validate message payload and finalize server-side (fixes #118) ([85cada9](https://github.com/darshi1337/apogee/commit/85cada90a39e2e7b62cdc664d89484e113ff9f01))
- Sanitize finalize object in stream-finished handler (fixes #119) ([5595de8](https://github.com/darshi1337/apogee/commit/5595de879940909d77d83c16b5acb3c69b13d231))
- Resolve image-size DoS vulnerabilities in web-ext (fixes #120) ([2232fd2](https://github.com/darshi1337/apogee/commit/2232fd2e05a30dd09217266da72fc14e7657cbcf))
- Encrypt or exclude plaintext page titles in cacheOrder (fixes #128) ([6546a4d](https://github.com/darshi1337/apogee/commit/6546a4da10a1f52d221ddadcb39fd2324788de47))
- Remove exposed global window.__apogeeHighlight (fixes #121) ([03106dc](https://github.com/darshi1337/apogee/commit/03106dce4029762b87b31eef17b280c33f4bb619))
- Remove exposed global window.extractPageContent (fixes #122) ([3339d28](https://github.com/darshi1337/apogee/commit/3339d28f5eee6d7d880bc672d1efb956981fd655))
- Sanitize sender email field against prompt injection (fixes #123) ([d397656](https://github.com/darshi1337/apogee/commit/d3976561d554a7a2d2c8246f7b0947cb41834b94))
- Cross-validate script tag data against page URL (fixes #124) ([f93a6a4](https://github.com/darshi1337/apogee/commit/f93a6a47ea9f6b94c1d76363e49aafa861b811f6))
- Enforce internal tab selection for summarize-multi-tab (fixes #125) ([31ffe4a](https://github.com/darshi1337/apogee/commit/31ffe4a93e7ac1ffd09b4ab5d62fd38bd3b68134))
- Add size limit on extract-pdf base64 input (fixes #126) ([1ae01f9](https://github.com/darshi1337/apogee/commit/1ae01f9c40076569b70ae2fb8518c35ea6f28565))
- Validate sender.tab context in message router (fixes #127) ([578d8b9](https://github.com/darshi1337/apogee/commit/578d8b95ac8d981a12a9828a50da8bb00c206894))

## [0.2.1] - 2026-08-19

### Added

- **Filter past summaries by title.** A search input above the past summaries list in the popup allows filtering stored summaries in real time by title or content preview. (#25)
- **Lobste.rs site extractor.** Custom extractor for Lobste.rs comment threads that strips navigation/vote metadata, parses comment trees into readable Markdown, and adds thread truncation options. (#22)
- **Detected extractor chip.** Display detected extractor chip (e.g. Lobste.rs, Wikipedia) in the popup header. (#28)
- **Optional YAML frontmatter on Markdown export.** Allow exporting summaries with YAML frontmatter containing metadata like title, URL, and date. (#29)
- **Hindi, Vietnamese, and Thai output languages.** Added output summary translation support for Hindi, Vietnamese, and Thai. (#27)
- **A Wikipedia extractor.** Wikipedia articles were going through the generic Readability path, which kept the whole citation apparatus. On the World War II article that was 169,014 characters in 30 chunks, of which 76,568 (45%) were See also, Notes, References, Further reading and External links. The extractor cuts from the first appendix heading, drops navboxes, infoboxes and the 506 inline citation markers, and re-emits the real section headings as Markdown so the heading-aware chunker can use them: the same article is now 85,659 characters in 17 chunks, and the section detector recognises 33 sections where it previously found 3. Article namespace only; anything else falls through to Readability. No network call.
- **Copy diagnostics as Markdown.** With engine logs recording, Settings now offers a button that copies your settings and the captured logs as a Markdown report ready to paste into an issue, so a bug report says which configuration produced it. Custom instructions and non-loopback Ollama hosts are reported as a shape (`set (42 chars)`, `custom host, port 11434`) rather than their contents. Previously the log panel was only reachable from the model progress bar, so it disappeared once a model was cached.

### Fixed

- **Remember last selected model per provider.** Switching between AI providers (In-Browser GPU, In-Browser CPU, Local Ollama) in Settings preserves and restores the previously selected model for each provider instead of resetting. (#26)
- **Raw engine and browser error strings no longer reach users verbatim.** Errors thrown by pdf.js, WebLLM, Transformers.js, Ollama, or the browser itself were rendered as-is in the popup and in desktop notifications. A new `UserFacingError` class marks messages written for users; everything else is mapped by `toUserMessage()` onto one of six generic fallbacks (PDF, in-browser model, Ollama, stream/disconnect, page-reading, and a catch-all), while the original error is preserved in `console.error` and the diagnostics buffer for bug reports. (#18)

### Changed

- **The popup follows the site's visual language.** Gradients and decorative shadows are gone (the landing page uses neither), the active segmented control is the purple accent rather than ink, the summary card separates by tint instead of shadow, and secondary labels are set in the mono eyebrow style the site uses.
- **Typography corrections in the popup.** The `@font-face` blocks declared a `100 800` weight range for variable fonts whose axis is `200 700`, so the browser was synthesising weights instead of using the real masters. Font families now come from tokens with proper fallback stacks (47 declarations had no fallback at all), and the size scale is eight integer steps instead of thirteen including six half-pixel values.
- **Removed dotted heading patterns.** Removed dotted pattern under headings except the last.

### Removed

- **Four unused bundled fonts.** `Metropolis-{Regular,Medium,Bold}.otf` and `MozillaText-Bold.ttf` were referenced by nothing but were copied into every build, adding roughly 137 KB to the packaged extension.

### Security

- **Prompt fencing and injection protection.** Content fencing and explicit grounding rules added across all prompt builders in `prompts.js` to mitigate prompt injection risks. (#10)
- **Bumped `pdfjs-dist` from 6.1.200 to 6.2.108**, clearing GHSA-hq66-cqwq-w95j (arbitrary JavaScript execution upon opening a malicious PDF). The two existing mitigations (`isEvalSupported: false` and the extension CSP's lack of `unsafe-eval`) already blocked the exploit path, but a known-vulnerable dependency is flagged by `npm audit` and by store reviewers. `npm audit --omit=dev` now reports zero vulnerabilities. (#15)

## [0.2.0] - 2026-08-06

### Fixed

- **The documented permissions now match the manifest.** The privacy policy claimed no host access beyond loopback while the extension also holds `*.bilibili.com` / `*.hdslb.com` for subtitle fetches; the README and the store listing justified a `clipboardWrite` permission that is not requested (the copy buttons use the async Clipboard API, which needs none) and omitted `declarativeNetRequestWithHostAccess`, which is. All four documents now describe the same permission set.
- **Get in touch** is down to the three actions plus a footer: the About Apogee blurb is gone (the same copy already lives in the README and the store listing), and the version line it sat above stays.
- **PDF summarization/Q&A now works on Chrome/Edge.** The PDF's bytes were passed between extension contexts as a raw `ArrayBuffer`, which Chromium's JSON-based message serialization silently turns into an empty object, so every PDF failed as "might be a scanned image" on Chrome/Edge (Firefox structured-clones messages and was unaffected). The bytes now travel base64-encoded. Real PDF failures (password-protected, invalid file) also surface their specific error message now instead of being flattened into the generic scanned-image text.
- **Background summarize (right-click/shortcut) on non-saved pages is no longer lost.** With "Don't save" enabled, or on a sensitive host (Gmail etc.), the per-tab resume pointer was refused entirely, so the completion notification's "click to view" led to an empty Home view. The pointer (stream id + URL hash, no page content) is now stored so the popup can reattach; summaries/Q&A content itself is still never written to disk for those pages.
- Concurrent writes to the summary/content/view-state FIFO indexes are now serialized per context, so two jobs finishing at once can't drop an index entry and leave an orphaned cache key behind.
- The popup no longer falls back to Home with a console error when opened without a granted tab URL (e.g. via a completion notification).
- The "Unknown or expired stream" internal error string was replaced with a user-readable explanation.
- **Summary and answer links now open in the current tab.** Clickable links in a summary or answer (e.g. YouTube jump-to-timestamp links) opened a new tab every time; they now navigate the tab being summarized in place.
- **Clicking a link in an expanded Past Summary no longer collapses the card.** A link inside an expanded entry (again, YouTube timestamps) bubbled up to the card's expand/collapse toggle, so following one also snapped the summary shut.
- **Long unbroken strings no longer get clipped.** A long URL, hash, or code span in a summary or answer ran past the popup edge (clipped by the popup's `overflow-x: hidden`) instead of wrapping; these now break to the next line.
- **An empty answer now explains itself.** A question that streamed back nothing left a blank bordered box, indistinguishable from a glitch; it now shows a short "No answer came back, try rephrasing" message.
- Past Summaries linkify their content deterministically instead of depending on whichever tab happens to be active (a stored summary carries no origin of its own, so only always-trusted YouTube timestamp links stay clickable).
- **A jump-link inside a Past Summary no longer hijacks the current tab.** Past summaries are for other pages, not the tab you're on, so their timestamp links now open a new tab instead of navigating whatever page you currently have open (only current-page summary/answer links seek the active tab).
- **Video summary cards show real content in their preview again.** A video summary opens with a "## Summary" (or "## Overview") heading, which the Past Summaries list rendered as the literal word "Summary" for every video; the preview now skips a leading heading and shows the first line of actual content.
- **The "time saved" badge no longer shows a wrong value on a restored summary.** When a tab carried a stale view state from a previously-visited URL, the badge could size itself against the wrong original (e.g. a past video's runtime applied to an article's cached summary); it is now shown only when the saved inputs belong to the page being displayed.
- Settings radio buttons keep their circular shape when a long label wraps, and the summary footer no longer leaves an empty gap when it has nothing to show (e.g. after a summarize error).
- **Long-running jobs are no longer killed mid-generation on Chrome.** Manifest V3 terminates the background service worker after ~30s without an extension event, and a job buffered there (Local Ollama always, Transformers.js on Firefox) can easily stay silent longer than that: a multi-chunk summarize emits nothing while it maps each chunk, and a cold Ollama model can take that long to return its first token. The worker was dying mid-fetch and the popup reported "Connection to the model was lost before the response finished". A 20s heartbeat now holds the worker up for exactly as long as a job (including the suggested-questions pass that follows it) is actually running.
- **Local Ollama summaries of long pages now report progress** instead of sitting on a frozen spinner until the final pass starts streaming. The map/reduce/translate stages report "Summarizing part N of M", "Merging summary", and "Translating", the same treatment the in-browser engines already had.

### Changed

- **No more remotely loaded code: WebLLM's per-model WASM kernels are now bundled into the Chrome package** (downloaded and SHA-256-verified at build time, see `apogee-extension/scripts/model-libs.mjs`) instead of being fetched from `raw.githubusercontent.com` at runtime, and that host was removed from the extension CSP. This closes a supply-chain hole and a Chrome Web Store "no remotely hosted code" policy risk; only model weights (data) are fetched at runtime. `@mlc-ai/web-llm` is now pinned exactly so the bundled kernels can't drift from the engine version.
- **SponsorBlock sponsor stripping now always runs.** The k-anonymity lookup is best-effort: when a video has no crowd data, the request fails, or you have turned the lookup off under Settings, Privacy, the local, network-free phrase heuristic runs instead, so sponsor reads are stripped either way.
- The two in-browser AI provider options are now labeled **In-Browser AI (GPU)** (WebGPU) and **In-Browser AI (CPU)** (Transformers.js), instead of two identical "In-Browser AI" rows told apart only by a small badge.
- A distinct amber "Checking…" status dot shows during the initial connection probe (which can take a few seconds on a cold WebGPU start) instead of the gray "disconnected" dot.
- The header logo no longer shows a clickable cursor on Home, where its "back to Home" click is a no-op; it still works as that shortcut from Summary and the other views.
- **Redesigned popup: an original duotone icon set and a flat, ruled layout.** The 26 shipped SVG assets are replaced by icons drawn for Apogee and inlined in `popup/icons.js`: every glyph is a soft accent fill under a `currentColor` stroke, so an icon takes the colour of the text beside it instead of being recoloured through a CSS filter. `icons.js` loads as its own module script, so glyphs still render if `popup.js` fails to boot, and icon buttons carry an `aria-label` now that there is no `<img alt>`. The surrounding chrome matches: rounded cards and drop shadows give way to boxes stacked flush on a shared hairline. The same set is shared with the landing page (`docs/app.js`).
- **Response format moved out of Settings** onto the home view, as a segmented bullets/sentences/paragraphs control directly under "Summarize this page", so the choice sits where it is used.
- **Internal code layout:** `lib/` (30 flat modules) and its `tests/` were reorganized into domain subfolders, `engines/`, `summarize/`, `language/`, `extract/`, `retrieval/`, `storage/`, and `util/`, with `constants.js` kept at the root. A pure move plus import-path rewrite; no behavior change.
- **Video summaries are now a length-scaled brief.** A YouTube or Bilibili summary is a short written gist plus a "Key moments" timeline of jump-to-timestamp links, sized to the video's length (a short clip gets a few moments, a long talk gets a denser timeline). When the video's description defines real chapters, the summary follows those chapters instead, with a section per chapter. Every timestamp stays a clickable link back to that moment in the video.
- **The "~X min saved" badge now persists across popup reopen.** The inputs it needs (a video's runtime, or the original page's word count) are saved alongside the summary, so the badge is recomputed and shown again when a cached summary is restored, instead of vanishing the first time the popup was closed and reopened.

### Added

- **A landing page** at <https://darshi1337.github.io/apogee/>, served from `docs/` and published by a GitHub Pages workflow on every push to main that touches it. Static, no build step, and it shares the extension's icon set.
- **Bilibili video support.** Bilibili videos are now summarized the same way YouTube videos are: the extractor pulls the video's timestamped subtitle track (fetched through the service worker, using your existing Bilibili login, since Bilibili only exposes subtitles to a signed-in session) and the summary carries jump-to-moment links back into the video (`?t=<seconds>`). Multi-part videos honor the `?p=N` selector, and a video with no subtitles falls back to a description-only summary. See the privacy policy for the one new network request this adds.
- **Custom instructions.** A free-text box under Settings lets you add standing instructions (e.g. "Explain like I'm five", "Focus on the technical details", "Answer in a formal tone") that are appended to every summary and Ask answer on top of Apogee's built-in prompt. They are layered under the grounding rules, so a page cannot smuggle instructions through this channel, and capped at 2000 characters. Leave it blank to use the defaults unchanged.
- **Translations: summaries, Q&A answers, and suggested questions can now be produced in a chosen output language** (Settings, then Summary language; 29 languages, English by default, "Same as article" to keep the source language). Two engines are selectable under Settings, then Translation engine: the default **LLM** engine (the summarization model writes directly in the target language, verified, with a translate-pass fallback, no extra download), and an opt-in **Opus-MT** engine (dedicated Helsinki-NLP translation models, ~80&nbsp;MB each, downloaded from Hugging Face and cached offline) that generates neutrally then translates deterministically while preserving bullet/timestamp structure. Opus-MT is stronger on low-resource languages; it uses dedicated `opus-mt-en-<code>` models where available, the grouped `opus-mt-en-mul` model otherwise, and falls back to the LLM engine for the handful of languages it can't reach (Slovak, Korean, Traditional Chinese). See the README "Translations" section for the full per-language model table.
- Keyboard accessibility: Settings radio buttons have a visible focus ring again, summary bullets can be focused and activated (Enter/Space) for highlight-in-page, and all decorative motion is disabled under `prefers-reduced-motion`.
- **Screen reader support across the popup.** The connection status pills and the model-download banner are live regions, the progress bar reports its value through `role="progressbar"` (the percentage text is hidden from assistive tech so it can't re-announce on every tick), and a clipped live region speaks the events that have no visible text of their own: summary ready, answer ready, copied. Summary failures announce as alerts. The logs panel, the prompts toggle and each past-summary card now expose `aria-expanded`, and switching views moves focus to the view being opened instead of leaving it stranded on the hidden one.
- The **Get in touch** footer credits contributors, linking to the repository's contributor graph.
- Bundled font licenses are now documented and shipped (`apogee-extension/assets/fonts/LICENSE.md`).

### Security

- **Cache keys are derived with SHA-256 instead of a 53-bit non-cryptographic hash.** Summary, prompt and page-content keys, plus the per-tab view-state pointer, are keyed by a truncated SHA-256 of the page URL. The previous cyrb53 digest was short enough to brute-force against a candidate URL list, so anyone with local access to extension storage could confirm which pages had been summarized; that no longer holds. Keys written by earlier versions simply miss and age out of the FIFO, which costs one re-summarize per cached page. cyrb53 remains where it is not a privacy boundary (the in-memory embedding index).
- Engine progress logging is now opt-in rather than always writing model-loading diagnostics to the console. Errors are still logged unconditionally. It is switchable in two places that stay in sync: **Settings, then Diagnostics**, which can be armed before starting a job (what a bug report needs), and the existing **Show logs** panel, which only exists while the model-progress banner is on screen.

## [0.1.9] - 2026-07-25

### Changed

- **Bullet summaries of long documents are now deduplicated and coherent.** Bullets mode previously streamed each chunk's bullets straight through with no merge step, so a long multi-chunk document (e.g. a big PDF) could repeat the same point across chunk boundaries. It now runs the same map + reduce shape as the other modes: every chunk is summarized, then a single synthesis pass merges them into one deduplicated list. To avoid the old regression where a fixed 8-14-bullet reduce crushed a whole document down to almost nothing, the reduce pass scales its target bullet count with the number of chunks merged (grows per chunk beyond the first, capped so a very long document stays skimmable). WebLLM and Ollama share this logic, so both backends produce identical output for the same page.

### Added

- **Transformers.js (in-browser CPU AI) is now available on Chrome/Edge**, not just Firefox, as an opt-in alternative to WebLLM in Settings, useful on machines without WebGPU.
- **Resummarize button** on the finished summary card, re-runs the summarize flow (re-extracting the live page, not a stale cache) without going back to Home first. Shares the same cancel-in-flight/re-run path as the Home "Summarize this page" button.
- **"~X min saved" badge** on the finished summary card, estimated locally from original vs. summary word count against an average reading speed, no server round-trip. Hidden when the gap is negligible (near-empty page, or a summary that isn't meaningfully shorter) or when the summary came straight from cache on popup reopen, since the original page text isn't held onto in that case. For YouTube videos the badge instead compares the video's actual runtime against the time to read the summary, since a transcript's word count doesn't track spoken-word runtime the way normal reading speed tracks normal reading.
- **Timestamped YouTube summaries.** The transcript extractor now threads inline `[MM:SS]` markers through the text (from SponsorBlock/heuristic- cleaned captions), and the summarizer cites them as clickable links back to that moment in the video (`&t=SECONDSs`), inspired by [tantara/openbrief](https://github.com/tantara/openbrief)'s YouTube summarizer. Every point still follows your chosen response format (bullets, sentences, or paragraphs); each one just leads with its timestamp link now. Long videos are condensed in a map pass (one model call per transcript chunk) before a single assembly pass turns the notes into the final summary, the same chunking budget per-model summaries already use.

### Fixed

- **YouTube timestamp links on Shorts.** Timestamp deep-links assumed a `watch?v=` URL with an existing query string, so a bare `/shorts/<id>` URL produced a broken `/shorts/abc&t=42s`. Links now normalize to a canonical `watch?v=<id>&t=` URL when the video id is recognizable (Shorts, `youtu.be`, or `watch`), and otherwise pick the right `?t=`/`&t=` separator for whatever URL they were given.
- **Cancelling one summary no longer interrupts another.** Cancelling a WebLLM stream called `interruptGenerate()` unconditionally, so cancelling a queued or already-finished job during a rapid resummarize could stop the different job that actually held the engine. The offscreen document now tracks which stream owns the engine and only interrupts when the cancelled stream is the one generating.
- **Malformed Ollama responses report the real cause.** A bad line in Ollama's streaming NDJSON used to surface as "Could not connect to Ollama…", sending users to chase a networking problem that wasn't there; it now reports a malformed-response error instead.
- **Background summarize on an empty page is no longer silent.** A context-menu or keyboard-shortcut summarize that bailed early (unreadable page, no thread open in Gmail, image-only PDF) returned with no feedback; it now posts a "Nothing to summarize" notification explaining why.
- **Transformers.js no longer freezes on long articles.** Input past the model's context budget used to grow chunks without bound instead of capping them, so a long page could stall for tens of minutes with no visible progress, indistinguishable from a hang. Long input is now truncated to a bounded number of context-sized chunks instead (with a "Long page, summarizing the beginning" notice), generation length is capped, and the progress line updates continuously with a running word count instead of sitting on one static message for the whole wait.
- Summary error messages use a theme-aware color instead of a hardcoded red.

### Security

- **Links in model output are restricted to the summarized page's own origin** (plus `youtube.com`, the only host Apogee itself asks the model to link to, for jump-to-video timestamps). Because model output is steered by page content, a malicious page could otherwise get a phishing link, dressed as a timestamp, rendered as a real clickable link in the popup; such links now render as plain text.
- **Per-tab view state is cleared when a tab closes** rather than lingering until FIFO eviction, and **completion notifications omit the page title on sensitive hosts** (email, messaging), where a title can carry a subject line or address that OS notification centers may log persistently.
- **The Transformers.js WASM runtime is now bundled with the extension** instead of being fetched from jsDelivr at runtime, closing the last unverified-remote-code path in the in-browser inference stack. Chrome's CSP no longer needs a CDN allowance at all.

## [0.1.8] - 2026-07-21

### Added

- **Cancel button for Summarize and Ask.** Cancelling now actually interrupts generation server-side instead of just hiding the UI while the job kept running in the background: `engine.interruptGenerate()` for WebLLM, an `AbortController`-driven `fetch` abort for Local Ollama, and a checked signal between chunks for Transformers.js. Cancelling a summary returns to Home; cancelling a question returns to the empty question box rather than discarding the page context.
- **Copy-to-clipboard** buttons on the generated summary, the Ask answer, and each entry in the new Past Summaries list below.
- **Past Summaries list on Home**, populated from the same local cache that already backed instant reopens. Shows the first line of each summary as a one-line preview (markdown markers stripped), click to expand in place. Capped at the 8 most recent; hidden entirely with nothing cached yet (fresh install) or after clearing data.
- The logo/brand mark in the header is now clickable and returns to Home from the Summary view.
- Rotating playful loading text while summarizing (`TL;DRing`, `Distilling`, `Orbiting`, `Reaching apogee`, and 30+ more), picked at random each time instead of always showing the same "Summarizing" label.
- A one-line credit to Mozilla's discontinued Orbit as this project's inspiration, on the "Get in touch" page.
- **Page titles in the Past Summaries list.** Entries previously showed only a one-line text preview, URLs are deliberately never stored (even cache keys only carry a hash), so there was no way to tell entries apart at a glance; each card now also shows the page's title above the preview. Entries persisted before this existed just show the preview alone.
- **Right-click "Summarize this page"** context-menu entry and a keyboard shortcut (default `Alt+Shift+U`, remappable any time via `chrome://extensions/shortcuts`) that summarize the active tab without opening the popup at all. A hint badge on the "Summarize this page" button shows whatever the shortcut is actually currently bound to (read live via `chrome.commands.getAll()`, so it can't go stale if you remap or clear it, unlike a hardcoded label). A system notification fires when a shortcut/context-menu-triggered summary finishes (or fails); clicking it focuses the tab and opens the popup. Opening the popup while a background-triggered summary is still generating now shows the normal loading view (spinner, rotating verb) and live-streams the result, the same as a popup-triggered summary, instead of the default Home page with no indication anything is happening.
- **"Copy as Markdown"** button next to the existing plain-text copy button on the summary card, formats a proper note (title, source URL, summary body) for pasting into notes apps, distinct from the plain-text copy.
- **Highlight-in-page.** Click a summary bullet (or sentence/paragraph line, depending on your chosen format) to scroll to and highlight the passage of the original page it's most likely grounded in, so you can visually check the model isn't inventing things. Uses the same on-device embedding retrieval Ask already relies on to find the best-matching original-content chunk, then locates and highlights it in the live page via the CSS Custom Highlight API (no DOM mutation, so it doesn't fight React/Vue-managed pages that revert unexpected changes). Chromium-only for now, the same constraint Ask's own retrieval already has (needs the offscreen document); the affordance simply isn't shown on the Firefox build.

### Changed

- Replaced the entire icon set. The originals were raster images (17-36 KB each) wrapped in an SVG `<pattern>` purely so a CSS filter hack could tint them, which is why they looked soft and needed the imprecise filter in the first place. Now real vector icons from [Lucide](https://lucide.dev) (ISC) and the GitHub mark from [Simple Icons](https://simpleicons.org) (CC0), 320-820 bytes each. Also fixed five places that were reusing one icon for two or three unrelated settings (Status/Privacy, the two in-browser model cards, Backend), each now has its own.
- Light theme's icon color only had 2.56:1 contrast against white (measured, not eyeballed), under the 3:1 WCAG minimum for graphical UI elements, which is why it read as washed-out; retuned to 5.52:1 while leaving dark theme (already 8.2:1) untouched.
- The Settings back button now returns to whichever page it was opened from (Home or Summary) instead of always landing on Home, which previously discarded a just-generated summary still sitting in the DOM.
- "Ask Apogee a question" no longer shows an empty "Suggested Prompts" heading before a question has been asked.
- Every page's header now has rounded top corners. (Rounding all four corners was also tried, via `overflow: hidden` on the outer container, but that broke the sticky header, confirmed by a real scroll test showing it no longer stayed pinned, so it's top corners only for now.)
- Various spacing fixes: redundant stacked bottom padding on the Settings and Get in touch pages (56px down to a normal 36px), the gap below "Summarize the page" before the loading indicator, the `model-progress` card sitting flush against the header (missing top margin), and the gaps directly above/below the new Past Summaries list.
- Settings' "Backend" card is now labeled "Ollama", and its URL field's placeholder shows Ollama's actual default port (`:11434`, was showing `:8000`, left over from the old backend-server era). The field also now auto-prefixes `http://` onto a bare `host:port` value (e.g. `127.0.0.1:11434`), and surfaces the specific reason a host was rejected (wrong scheme, non-loopback host) instead of the same generic "connect to Ollama to see yours" shown when Ollama simply isn't running yet.
- The debug-logs toggle is now a real `<button>` instead of a `<span>` with a click handler, restoring keyboard focus/activation. The debug-logs panel itself moved off hardcoded dark-only inline styles onto the same themed CSS variables as the rest of the popup (it was nearly invisible in light theme).
- `prefers-reduced-motion` now also covers the connected-status pulse and the hover translate/scale transforms throughout the popup, not just the loading spinner and dots.
- The popup's initial view (a resumed stream, a cached summary, Settings, etc.) no longer waits on the WebGPU/Ollama connectivity probe before rendering. That probe can take several seconds on a cold start (creating the offscreen document) and has no bearing on which view should be shown.
- Dependency hygiene: `web-ext` now lives in `apogee-extension/package.json` (where it's actually used) instead of the repo root; `npm audit` is clean (0 vulnerabilities, was 3 high via `adm-zip`/`onnxruntime-node`, both Node-only dev tooling that never ships in the extension itself).
- Summaries are now persisted (and suggested questions generated) by the background job itself as soon as it finishes, not by whichever popup happens to still be open long enough to consume the stream. This is what makes the context-menu/keyboard-shortcut entry points above possible at all (there's no popup to rely on), and as a side effect fixes a pre-existing gap where an ordinary popup-triggered summary could be silently lost if the popup was closed before the 2-minute stream-buffer window expired.
- `manifest.json` gained `contextMenus` and `notifications` permissions and a `commands` entry, needed for the two new entry points above. No new host permissions or outbound network calls came with any of this.

### Removed

- Dead code left over from earlier refactors: the unused provider-level `suggestQuestions()` methods and their corresponding service-worker/ offscreen message handlers (`load-model`, `unload-model`, and three `*-suggest-questions` variants with no remaining caller). The actually-used suggested-questions path, the backgrounded job that persists results to storage, is unaffected.
- The unused `ClashDisplay` font: declared via `@font-face` but never applied anywhere, shipped in every install for nothing.

### Fixed

- `manifest.json` was missing the `clipboardWrite` permission. Without it, `navigator.clipboard.writeText()` from a popup can trigger an interactive permission prompt, which, combined with the popup's auto-close-on-blur behavior, could silently close the popup mid-copy, i.e. the copy button appearing to "disappear" and never actually copying anything.
- The dev-only `popup/mock.js` shim was missing `chrome.storage.onChanged`, which `popup.js` calls unconditionally at load, silently breaking the entire "open popup.html directly for UI iteration" workflow described in its own code comment (no click handlers ever attached).
- Asking a follow-up question about a PDF, after summarizing it, used to silently discard the already-extracted PDF text and re-run extraction from scratch, which returns no text for PDFs (that needs `pdf.js`, run separately via the service worker); asking without summarizing first failed outright with "Could not extract enough page content to answer." Both paths now reuse or re-extract the real PDF text correctly.
- The model-progress banner ("Summarizing part 2 of 3...", "Reconnecting to local model...") no longer lingers indefinitely after the job finishes. It previously only auto-hid on reaching 100% download progress, which text-only status messages never report.
- Copy buttons for the summary and the Ask answer now reappear correctly after reopening the popup on a cached/resumed result, instead of staying hidden (and, for the answer, copying nothing even if manually revealed).
- Starting a new summarize or ask while a previous one was still generating now cancels the previous job, instead of leaving it running in the background for up to two minutes and racing the new one to update the DOM.
- A stale cross-build provider setting (e.g. `"webllm"` left over in a Firefox profile) no longer silently fails to generate suggested questions; it's now normalized the same way the main provider selection already was.
- Summarizing or asking about a browser-internal page (`chrome://`, `about:`, etc.) now shows a clear "Apogee can't read this page" message instead of the raw low-level error `chrome.scripting.executeScript` throws for those.

### Security

- Tightened the Ollama host allowlist to exactly match what's actually reachable/declared: dropped `https:` and the IPv6 `[::1]` literal, which used to pass validation but could never really be fetched (blocked by the manifest's own CSP on Firefox, and not declared in `host_permissions` either way).
- Narrowed the YouTube caption-URL allowlist from `*.google.com` (far wider than captions are ever actually served from) down to `*.youtube.com` / `*.googlevideo.com`.
- Added Telegram, Slack, Discord, and Microsoft Teams to the list of hosts whose content is never persisted to disk regardless of the history setting (previously covered Gmail, Outlook, Proton Mail, Yahoo Mail, Google Messages, and WhatsApp Web).

## [0.1.7] - 2026-07-19

### Added

- **In-browser AI on Firefox via Transformers.js.** Firefox has no `browser.offscreen` API, so WebLLM (WebGPU) can never run there; Firefox now gets its own in-browser provider instead, running ONNX models on-device via WebAssembly (no offscreen document or dedicated Worker required). Ships with three models (SmolLM2 360M, default; Qwen 2.5 0.5B; Llama 3.2 1B), selectable from the same settings UI as WebLLM. Works well on modern/fast CPUs; on older or low-power hardware, Local Ollama remains the faster option.
- **Retrieval-augmented "Ask" answers.** Instead of truncating long pages to the first ~8000 characters, Apogee now embeds the page locally (a small on-device model) and answers using only the passages most relevant to the question, so questions about content buried deep in long articles, PDFs, or video transcripts are answered correctly. Falls back to the previous truncation behavior if embedding is unavailable (and always on Firefox, which has no offscreen document to run it in).
- **Live Ollama model list.** Local Ollama settings now show whatever models you've actually pulled (via Ollama's own `/api/tags`), not just the 4 hardcoded ones. Falls back to that hardcoded list when Ollama isn't reachable yet, and never silently drops your currently-selected model even if it's missing from a live response.
- **Per-model chunk sizing for summarization.** Chunk size for Local Ollama models now scales with that model's context window (matched by family, e.g. `llama3.1`, `qwen2.5`, `gemma3`) instead of one fixed size for every model, so capable models need fewer passes over long content. WebLLM's in-browser models are unaffected, they share the same small context window regardless of which one is picked.

### Fixed

- SponsorBlock sponsor-segment lookups now work on the Firefox build: the background page's fetches are bound by the extension CSP there (unlike Chrome's service worker), and `sponsor.ajay.app` was missing from the Firefox `connect-src`, so every lookup silently fell back to the local phrase heuristic.
- The Transformers.js engine now disposes a failed engine before reloading, instead of leaking its WASM memory (hundreds of MB of model weights) for the life of the background page.
- A failed suggested-questions job (e.g. a storage write hitting quota) no longer permanently blocks prompt regeneration for that page.
- Cached view state and extracted page content no longer store the raw page URL on disk; only a hash is kept. Cache keys were already hashed (URLs can carry session tokens in their query strings), but a plaintext copy lingered inside the stored values, undermining that.
- A stale or unknown provider setting (e.g. carried over from the other browser's build) now falls back to this build's in-browser provider instead of routing to one that can't run here.
- The README's privacy section now discloses the SponsorBlock lookup and covers the Firefox WASM inference path; the in-browser "Connected" status for Transformers.js now reflects actual WASM availability.

### Security

- The Ollama status/model-list probe now enforces the same loopback-only host validation as every other Ollama request. Previously a non-loopback URL saved in the host setting would be fetched (`/api/tags`) on every popup open, the one gap in the extension's own SSRF rule.

## [0.1.6] - 2026-07-17

### Changed

- **Local Ollama mode now connects directly to Ollama's HTTP API from the extension.** There's no separate backend process to install or run anymore, the extension talks to `http://127.0.0.1:11434` itself (see the README's "Advanced: Local Ollama Mode" section for the one-time `OLLAMA_ORIGINS` setup this requires).
- PDF summarization now extracts text fully client-side via `pdf.js`, and works in both WebLLM and Local Ollama modes (previously Local Ollama only, via the backend).

### Removed

- The `apogee-backend` Node.js server package, superseded by the direct Ollama connection above.

### Added

- ESLint + Prettier tooling (`npm run lint` / `npm run format`) and a GitHub Actions CI workflow running format checks, lint, tests, and the build on every push/PR.
- `CONTRIBUTING.md` and this changelog.

## [0.1.5] - 2026-07-16

- Backend Node port, security/reliability hardening, docs.

## [0.1.4] - 2026-07-15

- Privacy controls, YouTube transcript, and UI fixes.
- Suggested questions moved to a background job with improved state management.
- Popup view now persists across reopens; summarize/ask jobs decoupled from the popup's lifetime.
- Closed an SSRF redirect bypass, tightened CORS/local-file exposure, and hardened PDF error handling.

## [0.1.3] - 2026-07-13

- Cleaned up unused code and dependencies.
- Fixed a duplicate `MAX_CHUNK_CHARS` declaration in `chunk.js`.
- Merged WebLLM bug fixes and performance improvements: UUID stream IDs, escaped HTML output, a FIFO-bounded summary cache, chunked/truncated prompts, and an offscreen-document idle keep-alive.
- Added Dia browser install instructions.

## [0.1.2] - 2026-07-10

- Fixed an AMO (addons.mozilla.org) submission issue and a caching bug.

## [0.1.1] - 2026-07-09

- Added WebLLM/WebGPU in-browser inference support.
- Added an AWS deployment option for the backend.
- Scoped extension permissions to the active tab and locked network egress to loopback.
- Hardened PDF path checks, an XSS issue in the loading indicator, and the markdown regex; improved streaming UX and error display.
- Fixed macOS/Chrome compatibility issues.

## [0.1.0] - 2026-06-24

- Initial release.

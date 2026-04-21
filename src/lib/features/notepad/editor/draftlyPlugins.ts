import {
  CodePlugin
} from 'draftly/src/plugins/code-plugin';
import { EmojiPlugin } from 'draftly/src/plugins/emoji-plugin';
import { HeadingPlugin } from 'draftly/src/plugins/heading-plugin';
import { HRPlugin } from 'draftly/src/plugins/hr-plugin';
import { HTMLPlugin } from 'draftly/src/plugins/html-plugin';
import { ImagePlugin } from 'draftly/src/plugins/image-plugin';
import { InlinePlugin } from 'draftly/src/plugins/inline-plugin';
import { LinkPlugin } from 'draftly/src/plugins/link-plugin';
import { ListPlugin } from 'draftly/src/plugins/list-plugin';
import { ParagraphPlugin } from 'draftly/src/plugins/paragraph-plugin';
import { QuotePlugin } from 'draftly/src/plugins/quote-plugin';
import { TablePlugin } from 'draftly/src/plugins/table-plugin';

// Keep the editor on the smaller plugin surface the app actively uses.
// Draftly's bundled `allPlugins` also pulls in Mermaid and Math support,
// which drags a large transitive client payload into every note route.
export const notepadDraftlyPlugins = [
  new ParagraphPlugin(),
  new HeadingPlugin(),
  new InlinePlugin(),
  new LinkPlugin(),
  new ListPlugin(),
  new TablePlugin(),
  new HTMLPlugin(),
  new ImagePlugin(),
  new CodePlugin(),
  new QuotePlugin(),
  new HRPlugin(),
  new EmojiPlugin()
];

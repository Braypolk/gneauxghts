// @ts-nocheck -- preserve the upstream JavaScript oracle verbatim.
// Unchanged @lezer/markdown 1.6.4 autolink implementation (MIT), recorded
// before the character-guard optimization. Test/diagnostic oracle only.
/*
MIT License

Copyright (C) 2020 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
const autolinkRE = /(www\.)|(https?:\/\/)|([\w.+-]{1,100}@)|(mailto:|xmpp:)/gy;
const urlRE = /[\w-]+(\.[\w-]+)+(:\d+)?(\/[^\s<]*)?/gy;
const lastTwoDomainWords = /[\w-]+\.[\w-]+($|[/:])/;
const emailRE = /[\w.+-]+@[\w-]+(\.[\w.-]+)+/gy;
const xmppResourceRE = /\/[a-zA-Z\d@.]+/gy;
function count(str, from, to, ch) {
    let result = 0;
    for (let i = from; i < to; i++)
        if (str[i] == ch)
            result++;
    return result;
}
function autolinkURLEnd(text, from) {
    urlRE.lastIndex = from;
    let m = urlRE.exec(text);
    if (!m || lastTwoDomainWords.exec(m[0])[0].indexOf("_") > -1)
        return -1;
    let end = from + m[0].length;
    for (;;) {
        let last = text[end - 1], m;
        if (/[?!.,:*_~]/.test(last) ||
            last == ")" && count(text, from, end, ")") > count(text, from, end, "("))
            end--;
        else if (last == ";" && (m = /&(?:#\d+|#x[a-f\d]+|\w+);$/.exec(text.slice(from, end))))
            end = from + m.index;
        else
            break;
    }
    return end;
}
function autolinkEmailEnd(text, from) {
    emailRE.lastIndex = from;
    let m = emailRE.exec(text);
    if (!m)
        return -1;
    let last = m[0][m[0].length - 1];
    return last == "_" || last == "-" ? -1 : from + m[0].length - (last == "." ? 1 : 0);
}
/**
Extension that implements autolinking for
`www.`/`http://`/`https://`/`mailto:`/`xmpp:` URLs and email
addresses.
*/
const Autolink = {
    parseInline: [{
            name: "Autolink",
            parse(cx, next, absPos) {
                let pos = absPos - cx.offset;
                if (pos && /\w/.test(cx.text[pos - 1]))
                    return -1;
                autolinkRE.lastIndex = pos;
                let m = autolinkRE.exec(cx.text), end = -1;
                if (!m)
                    return -1;
                if (m[1] || m[2]) { // www., http://
                    end = autolinkURLEnd(cx.text, pos + m[0].length);
                    if (end > -1 && cx.hasOpenLink) {
                        let noBracket = /([^\[\]]|\[[^\]]*\])*/.exec(cx.text.slice(pos, end));
                        end = pos + noBracket[0].length;
                    }
                }
                else if (m[3]) { // email address
                    end = autolinkEmailEnd(cx.text, pos);
                }
                else { // mailto:/xmpp:
                    end = autolinkEmailEnd(cx.text, pos + m[0].length);
                    if (end > -1 && m[0] == "xmpp:") {
                        xmppResourceRE.lastIndex = end;
                        m = xmppResourceRE.exec(cx.text);
                        if (m)
                            end = m.index + m[0].length;
                    }
                }
                if (end < 0)
                    return -1;
                cx.addElement(cx.elt("URL", absPos, end + cx.offset));
                return end + cx.offset;
            }
        }]
};

export { Autolink };

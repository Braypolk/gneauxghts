//! Rust ownership checks inspect production items, never comments or test fixtures.
use proc_macro2::{Span, TokenStream, TokenTree};
use std::ops::Range;
use syn::{spanned::Spanned, visit::Visit, Attribute, Item};

pub fn compact(source: &str) -> String {
    source.chars().filter(|c| !c.is_whitespace()).collect()
}
struct Coordinates<'a> {
    source: &'a str,
    starts: Vec<usize>,
}
impl<'a> Coordinates<'a> {
    fn new(source: &'a str) -> Self {
        let mut starts = vec![0];
        starts.extend(source.match_indices('\n').map(|(at, _)| at + 1));
        Self { source, starts }
    }
    fn range(&self, span: Span) -> Range<usize> {
        let offset = |line: usize, column: usize| {
            let start = self.starts[line.saturating_sub(1)];
            start
                + self.source[start..]
                    .char_indices()
                    .nth(column)
                    .map_or(self.source.len() - start, |(offset, _)| offset)
        };
        offset(span.start().line, span.start().column)..offset(span.end().line, span.end().column)
    }
}
fn test_only(attrs: &[Attribute]) -> bool {
    attrs.iter().any(|attr| {
        attr.path().is_ident("cfg")
            && attr
                .parse_args::<syn::Path>()
                .is_ok_and(|path| path.is_ident("test"))
    })
}
fn attrs(item: &Item) -> &[Attribute] {
    match item {
        Item::Const(v) => &v.attrs,
        Item::Enum(v) => &v.attrs,
        Item::ExternCrate(v) => &v.attrs,
        Item::Fn(v) => &v.attrs,
        Item::ForeignMod(v) => &v.attrs,
        Item::Impl(v) => &v.attrs,
        Item::Macro(v) => &v.attrs,
        Item::Mod(v) => &v.attrs,
        Item::Static(v) => &v.attrs,
        Item::Struct(v) => &v.attrs,
        Item::Trait(v) => &v.attrs,
        Item::TraitAlias(v) => &v.attrs,
        Item::Type(v) => &v.attrs,
        Item::Union(v) => &v.attrs,
        Item::Use(v) => &v.attrs,
        _ => &[],
    }
}
struct Exclusions<'a> {
    coordinates: &'a Coordinates<'a>,
    ranges: Vec<Range<usize>>,
}
impl<'ast> Visit<'ast> for Exclusions<'_> {
    fn visit_attribute(&mut self, attr: &'ast Attribute) {
        if attr.path().is_ident("doc") {
            self.ranges.push(self.coordinates.range(attr.span()));
        }
    }
    fn visit_item(&mut self, item: &'ast Item) {
        if test_only(attrs(item)) {
            self.ranges.push(self.coordinates.range(item.span()));
        } else {
            syn::visit::visit_item(self, item);
        }
    }
    fn visit_impl_item_fn(&mut self, item: &'ast syn::ImplItemFn) {
        if test_only(&item.attrs) {
            self.ranges.push(self.coordinates.range(item.span()));
        } else {
            syn::visit::visit_impl_item_fn(self, item);
        }
    }
    fn visit_expr_block(&mut self, block: &'ast syn::ExprBlock) {
        if test_only(&block.attrs) {
            self.ranges.push(self.coordinates.range(block.span()));
        } else {
            syn::visit::visit_expr_block(self, block);
        }
    }
}
fn token_ranges(coordinates: &Coordinates, stream: TokenStream, ranges: &mut Vec<Range<usize>>) {
    for token in stream {
        if let TokenTree::Group(group) = token {
            ranges.push(coordinates.range(group.span_open()));
            token_ranges(coordinates, group.stream(), ranges);
            ranges.push(coordinates.range(group.span_close()));
        } else {
            ranges.push(coordinates.range(token.span()));
        }
    }
}
pub fn production_rust(source: &str) -> String {
    let file = syn::parse_file(source).expect("parse Rust architecture input");
    let coordinates = Coordinates::new(source);
    let mut exclusions = Exclusions {
        coordinates: &coordinates,
        ranges: Vec::new(),
    };
    exclusions.visit_file(&file);
    let mut tokens = Vec::new();
    token_ranges(
        &coordinates,
        source.parse().expect("lex Rust architecture input"),
        &mut tokens,
    );
    // Preserve offsets and line layout for function extraction, while blanking comments.
    let mut bytes = source
        .as_bytes()
        .iter()
        .map(|byte| if *byte == b'\n' { b'\n' } else { b' ' })
        .collect::<Vec<_>>();
    for span in tokens {
        bytes[span.clone()].copy_from_slice(&source.as_bytes()[span]);
    }
    for span in exclusions.ranges {
        for byte in &mut bytes[span] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    }
    String::from_utf8(bytes).expect("preserved UTF-8 token boundaries")
}
/// A literal containing a call spelling cannot satisfy a structural positive gate.
pub fn without_string_literals(source: &str) -> String {
    fn gather(stream: TokenStream, coordinates: &Coordinates, ranges: &mut Vec<Range<usize>>) {
        for token in stream {
            match token {
                TokenTree::Group(group) => gather(group.stream(), coordinates, ranges),
                TokenTree::Literal(literal) if literal.to_string().contains('"') => {
                    ranges.push(coordinates.range(literal.span()))
                }
                _ => {}
            }
        }
    }
    // Non-Rust product files retain their existing explicit contract checks.
    if syn::parse_file(source).is_err() {
        return source.into();
    }
    let coordinates = Coordinates::new(source);
    let mut ranges = Vec::new();
    gather(source.parse().unwrap(), &coordinates, &mut ranges);
    let mut bytes = source.as_bytes().to_vec();
    for span in ranges {
        for byte in &mut bytes[span] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    }
    String::from_utf8(bytes).unwrap()
}

pub fn rust_function<'a>(source: &'a str, name: &str) -> &'a str {
    struct Find<'a> {
        name: &'a str,
        span: Option<Span>,
    }
    impl<'ast> Visit<'ast> for Find<'_> {
        fn visit_item_fn(&mut self, item: &'ast syn::ItemFn) {
            if item.sig.ident == self.name {
                self.span = Some(item.span());
            } else {
                syn::visit::visit_item_fn(self, item);
            }
        }
        fn visit_impl_item_fn(&mut self, item: &'ast syn::ImplItemFn) {
            if item.sig.ident == self.name {
                self.span = Some(item.span());
            } else {
                syn::visit::visit_impl_item_fn(self, item);
            }
        }
    }
    let file = syn::parse_file(source).expect("parse scoped Rust function input");
    let mut find = Find { name, span: None };
    find.visit_file(&file);
    &source[Coordinates::new(source).range(
        find.span
            .unwrap_or_else(|| panic!("expected Rust function `{name}`")),
    )]
}

#[test]
fn production_scanner_ignores_test_items_comments_and_string_braces() {
    let source = "// forbidden()\n#[cfg(test)] fn test_only() { forbidden(); }\nfn first() { let _ = r###\"} { /* ü */\"###; allowed(); }\n/* } */ fn later() { late(); }\n#[cfg(test)] mod tests { fn fixture() { forbidden(); } }";
    let clean = production_rust(source);
    assert!(!clean.contains("forbidden"));
    assert!(rust_function(&clean, "first").contains("allowed()"));
    assert!(!rust_function(&clean, "first").contains("late()"));
    assert!(rust_function(&clean, "later").contains("late()"));
}
#[test]
fn production_scanner_retains_forbidden_calls_across_formatting_and_private_modules() {
    for source in [
        "fn call(){ forbidden :: publish (); }",
        "mod private { fn call() { forbidden::publish(); } }",
    ] {
        let clean = production_rust(source);
        assert!(compact(&clean).contains("forbidden::publish()"));
    }
    let clean = production_rust(
        "impl Owner { #[cfg(test)] fn fixture() { forbidden(); } fn production() { allowed(); } }",
    );
    assert!(!clean.contains("forbidden"));
    assert!(rust_function(&clean, "production").contains("allowed"));
}

#[test]
fn strings_cannot_satisfy_structural_positive_checks() {
    let source = production_rust("fn real() { let fake = \"forbidden::publish()\"; allowed(); }");
    let code = without_string_literals(&source);
    assert!(!compact(&code).contains("forbidden::publish()"));
    assert!(compact(&code).contains("allowed()"));
}

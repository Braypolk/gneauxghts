import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ErrorPage from '../../routes/+error.svelte';

const fixture = vi.hoisted(() => ({ page: { status: 500, error: undefined as unknown } }));
vi.mock('$app/state', () => fixture);

afterEach(() => { fixture.page = { status: 500, error: undefined }; });

describe('client error page', () => {
  it('renders without a reference, with no navigation or retry controls', () => {
    const html = render(ErrorPage).body;
    expect(html).toContain('Workspace unavailable');
    expect(html).toContain('Recent changes may not have been saved.');
    expect(html).toContain('Reference: Unavailable');
    expect(html).toContain('readonly');
    expect(html).not.toMatch(/<button|<a\s/);
  });

  it('distinguishes expected 404s and exposes only the curated selectable summary', () => {
    fixture.page = { status: 404, error: {
      status: 404, message: 'SECRET_note_path_token', presentationCode: 'page_unavailable',
      diagnosticId: 'C-0123456789ab', stack: 'SECRET_stack'
    } };
    const html = render(ErrorPage).body;
    expect(html).toContain('Page unavailable');
    expect(html).toContain('Status: 404');
    expect(html).toContain('C-0123456789ab');
    expect(html).not.toContain('SECRET');
    expect(html).not.toContain('Recent changes');
  });
});

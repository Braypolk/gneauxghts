import { error } from '@sveltejs/kit';

export function load() {
  error(404, 'SECRET_expected_note_path');
}

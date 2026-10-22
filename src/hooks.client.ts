import type { HandleClientError } from '@sveltejs/kit/hooks';
import { presentClientError } from '#lib/app/clientErrorPresentation.js';

export const handleError: HandleClientError = (input) => presentClientError(input);

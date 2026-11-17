import { IS_DEMO_DATA } from '@/config/data-mode';
import type { Services } from './contracts';
import { apiServices } from './api';
import { mockServices } from './mock';

/**
 * One switch between the REST backend and the clearly-labelled demo data.
 * `NEXT_PUBLIC_TOUCHLINE_DATA=demo` keeps the offline sample fixtures; every
 * other value talks to the Fastify API.
 */
export const services: Services = IS_DEMO_DATA ? mockServices : apiServices;
export * from './contracts';

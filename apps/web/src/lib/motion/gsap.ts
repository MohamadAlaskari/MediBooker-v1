'use client';

import { useGSAP } from '@gsap/react';
import { motion } from '@medibooker/design-tokens';
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger, CustomEase);

/** The motion tokens as GSAP eases: the same curves as the CSS transitions (ADR 0008). */
export const EASE_ENTER = CustomEase.create('medibooker-enter', motion.ease.enter.join(','));

/** Seconds, as GSAP counts them. */
export const DURATION_SLOW = motion.duration.slow / 1000;
export const DURATION_FAST = motion.duration.fast / 1000;

export { gsap, useGSAP };

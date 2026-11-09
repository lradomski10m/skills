// Tunable pipeline configuration. Prices are estimates used for the run budget —
// the provider invoice is authoritative.

export const CONFIG = Object.freeze({
  models: Object.freeze({
    /** fal text-to-image endpoint for the start frames. No `num_images` → one request per option. */
    still: 'fal-ai/flux-2-pro',
    stillParams: Object.freeze({
      image_size: Object.freeze({ width: 1080, height: 1920 }),
      output_format: 'png',
      safety_tolerance: '2',
    }),
    clip: 'blackforestlabs/flux-3-max/image-to-video',
    clipParams: Object.freeze({
      duration: 5,
      aspect_ratio: '9:16',
      resolution: '720p',
      generate_audio: false,
    }),
    tts: Object.freeze({
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
    }),
  }),

  prices: Object.freeze({
    /** fal i2v per generated second at 720p, by UTC window (fal model page, Nov 2026). */
    clipPerSecond: Object.freeze([
      Object.freeze({ until: '2026-11-08T00:00:00Z', usd: 0.0425 }),
      Object.freeze({ until: '2026-11-23T00:00:00Z', usd: 0.085 }),
      Object.freeze({ until: null, usd: 0.17 }),
    ]),
    /** flux-2-pro: $0.03 first MP + $0.015 per extra MP (rounded up); 1080×1920 ≈ 2.07 MP → 3 MP. */
    stillPerImage: 0.06,
    /** ElevenLabs bills credits per character; USD depends on plan. Estimate only. */
    ttsPerThousandChars: 0.3,
  }),

  budget: Object.freeze({
    /** Default per-run cap on paid calls (override with --max-cost). */
    maxCostUsd: 15,
    /** Automatic re-rolls of a clip whose action beat cannot be found. */
    maxAutoRerolls: 2,
  }),

  stills: Object.freeze({ defaultOptions: 2 }),

  poll: Object.freeze({ intervalMs: 4000, timeoutMs: 15 * 60 * 1000 }),

  render: Object.freeze({
    width: 1080,
    height: 1920,
    fps: 30,
    crf: 17,
    preset: 'medium',
    audioRate: 48000,
    audioBitrate: '192k',
    /** Social platforms normalise to roughly -14 LUFS. */
    loudness: Object.freeze({ I: -14, TP: -1.5, LRA: 11 }),
    /**
     * Music bed, levelled against the voice: the bed's integrated loudness is set
     * to `levelDb` relative to the VO reference (energy mean of the run's VO
     * files), then ducked a further `duckDb` while any voice plays, so speech
     * sits ~|levelDb + duckDb| dB above the music. Ducking is planned from the
     * timeline's VO windows (deterministic, no compressor pumping): ramp down
     * `attackSec` before a line, back up over `releaseSec` after it; lines
     * closer than `mergeGapSec` stay ducked between them. Fades out over the
     * last `fadeOutSec`; a bed shorter than the video loops (logged).
     * Spec `music.levelDb` / `music.duckDb` override.
     */
    music: Object.freeze({ levelDb: -9, duckDb: -10, attackSec: 0.12, releaseSec: 0.35, mergeGapSec: 0.45, fadeOutSec: 0.4 }),
    /** Burned-in caption font for libass: the bundled bold face (engine/fonts/). */
    captionFont: Object.freeze({ file: 'Inter-Bold.ttf', family: 'Inter' }),
  }),

  layout: Object.freeze({
    /**
     * 9:16 safe area: TikTok/Reels/Shorts overlay UI on the top ~12% and the
     * bottom ~20%, so every overlay lives in safeTop..safeBottom.
     */
    safeTop: 236,
    safeBottom: 1536,
    /** Text overlays are anchored by their TOP edge, just inside the safe area. */
    hookTop: 268,
    ruleTop: 268,
    /**
     * Verdict sticker: centred, bottom edge near the frame bottom — every animal
     * is a centred head-and-shoulders shot, so this stays off the face. The user
     * accepts the platform UI overlapping it. Optional ✗ (CONFIG.marks) sits on
     * the sticker's upper-left corner via markY/markDx.
     */
    /** Sticker's visible bottom edge this far above the frame bottom (overlaps platform UI by choice). */
    stampBottomGap: 90,
    stampWidth: 600,
    markY: 1575,
    markDx: -265,
    markSize: 170,
    captionMarginV: 470,
    captionFontSize: 60,
    sideMargin: 96,
  }),

  /**
   * Overlay typography (Pango font descriptions). Default family: the bundled
   * Inter (OFL, full Latin Extended incl. Polish/Czech/… diacritics); a kit may
   * set its own (brand.json font.family + brand/fonts/). `monoFamily` is for
   * URL/order lines on the real-sheet panel.
   */
  typography: Object.freeze({
    family: 'Inter',
    monoFamily: 'Menlo, DejaVu Sans Mono, Consolas, monospace',
    hook: Object.freeze({ weight: 'Bold', sizePx: 54, lineSpacingPx: 4, padX: 44, padY: 26, radius: 30 }),
    rule: Object.freeze({ weight: 'Medium', sizePx: 38, lineSpacingPx: 2, padX: 34, padY: 18, radius: 26 }),
    endCard: Object.freeze({
      wordmark: Object.freeze({ weight: 'Bold', sizePx: 72 }),
      copy: Object.freeze({ weight: 'Medium', sizePx: 46, lineSpacingPx: 8 }),
      cta: Object.freeze({ weight: 'Bold', sizePx: 58, padX: 56, padY: 26 }),
      hint: Object.freeze({ weight: 'Medium', sizePx: 38 }),
    }),
    /** Words up to this length are glued to the next word (no "w"/"z" at a line end). */
    bindWordsUpToChars: 1,
    /** Soft drop shadow under overlay text so it reads on bright frames. */
    shadow: Object.freeze({ blurSigma: 6, opacity: 0.55, offsetY: 3 }),
    /** The hook has no box: a tight dark halo (edge definition) + a wide soft glow (busy backgrounds). */
    hookShadows: Object.freeze([
      Object.freeze({ blurSigma: 2.5, opacity: 0.95, offsetY: 1 }),
      Object.freeze({ blurSigma: 12, opacity: 0.6, offsetY: 3 }),
    ]),
  }),

  /**
   * Engine-only colours. Brand colours (accent, background, stamp colours,
   * panel gradient, sheet, QR finders, …) come from the kit's
   * brand/colours.json — see graphics.mjs `palette()`.
   */
  colors: Object.freeze({
    ruleFill: 'rgba(12,14,20,0.34)',
    pillStroke: 'rgba(255,255,255,0.14)',
    /** Dims an end-card background clip so the copy stays legible (alpha over the kit background). */
    endCardScrimAlpha: 0.68,
    offlineStill: Object.freeze(['#8c8f94', '#9a8f86', '#8e958c', '#8a8f99', '#b9a993']),
  }),

  alignment: Object.freeze({
    analysisWidth: 72,
    analysisHeight: 128,
    flash: Object.freeze({ searchMaxSec: 1.5, minDelta: 35 }),
    action: Object.freeze({
      /**
       * Ignore this long after the flash: i2v clips show exposure recovery and
       * small settling motion right after it (measured on the real quokka clip:
       * busy until ~1.1 s after a flash ending at 0.43 s).
       */
      settleSec: 0.7,
      smoothSec: 0.15,
      /**
       * Burst (mean motion over burstSec after the onset) vs run-up median.
       * Calibration: pure noise ≈ 1.0× (max 1.01 over 20 seeds), synthetic burst
       * over idle sway 1.7×, real quokka smile 3.2× (test/fixtures/quokka-real.json).
       */
      burstSec: 0.5,
      minContrast: 1.5,
      /** …and an absolute floor on the excess (mean luma change per pixel). */
      minPeakExcess: 0.4,
      minRunUpSec: 0.3,
      onsetFraction: 0.5,
      minPostBeatSec: 0.6,
    }),
    placement: Object.freeze({
      preFlashSec: 0.2,
      leadInSec: 0.15,
      preActionGapSec: 0.1,
      stampDelaySec: 0.3,
      clerkDelaySec: 0.3,
      quipGapSec: 0.15,
      /** Quip start after the thud when the clerk word is skipped. */
      quipAfterStampSec: 0.4,
      tailPadSec: 0.35,
      minSpeed: 0.7,
      minPostBeatSec: 0.9,
      payoffLeadInSec: 0.2,
      payoffMarkLeadSec: 0.4,
      /** With an intro, a payoff shot still shows at least this much of its clip. */
      payoffMinClipSec: 1,
    }),
  }),

  /**
   * Habitat intro before an animal clip: the same animal in its habitat (a
   * still, Ken Burns push-in), hard-cut ON the clip's flash — "the app removed
   * the background".
   */
  intro: Object.freeze({
    /** Still intro length (Ken Burns). */
    durationSec: 0.8,
    /**
     * Moving intro length. Its TAIL is used: the intro clip is generated to end
     * on the habitat still (its last frame matches the plain clip at the cut).
     */
    clipDurationSec: 1.2,
    /** Zoom gained over the intro (subtle push-in). */
    pushIn: 0.035,
    /** Zoom centre as a fraction of the frame — on the face, so it stays put across the cut. */
    focusX: 0.5,
    focusY: 0.55,
    /**
     * Framing correction if an intro still doesn't line up with its clip:
     * crop-centre offset (fraction of the source) and extra scale. 0/0/1 = the
     * still is framed like the clip's i2v source (verified for the quokka).
     */
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    /** Zoompan works on an upscaled frame so the push-in doesn't judder. */
    supersample: 2,
  }),

  /**
   * Result structure (rejected shots with stills/<shot>.result.png): action clip
   * in the habitat → flash → grin → hard cut to the result still → stamp + quip.
   */
  result: Object.freeze({
    /**
     * Max footage before the rule VO starts (longer heads are trimmed). Generous
     * on purpose: the habitat prelude (looking around) is wanted, and the hook
     * title covers the opening seconds.
     */
    maxLeadSec: 3,
    stampAfterCutSec: 0.3,
    tailSec: 0.45,
    minHoldSec: 1.2,
    /** Subtle push-in on the result still. */
    pushIn: 0.02,
    /**
     * Synthetic camera flash, when the action clip has none (or flash:
     * "synthetic"). Beat reads: moves around → goes still → AT the flash it
     * grins → the grin stays for the photo. So: the flash fires at the START of
     * the grin motion (the quiet valley before the rise — the half-height
     * onset was measured ~0.6 s late, with the grin already visible); only a
     * brief neutral hold precedes it (the rest of the neutral footage is cut,
     * never the prelude motion); the start→peak spread is time-compressed so
     * the grin completes ~spreadTargetSec after the flash; the grin holds
     * briefly, then the hard cut to the result still.
     */
    syntheticFlash: Object.freeze({
      /**
       * Where the flash fires (single continuous clips): 'complete' = the
       * action has settled (grin complete / tilt complete: still → action →
       * FLASH → held), 'peak' = the motion-energy peak (mid-action), or
       * 'onset' = the start of the motion. Multi-part actions always flash at
       * the onset and compress the spread after it.
       */
      anchor: 'complete',
      alphas: Object.freeze([0.9, 0.55, 0.25]),
      /** Multi-part actions only: neutral kept before the beat (earlier neutral footage is cut). */
      neutralHoldSec: 1,
      /**
       * The action is sped up only if it takes longer than this… Natural
       * actions play at natural speed: quokka grin 0.33 s, dog tilt 0.54 s.
       */
      spreadMaxSec: 0.6,
      /** …then to complete spreadTargetSec after the flash, within [min, max]×. */
      spreadTargetSec: 0.3,
      minSpreadSpeed: 2.5,
      maxSpreadSpeed: 4,
      /** Total hold after the action completes (footage first, then a freeze of the last frame), then the cut. */
      grinHoldSec: 0.4,
      /**
       * Single continuous clip: the beat is the FINAL burst — searched only in
       * the clip's last finalBeatSearchSec (and allowed up to the very end),
       * so earlier movement (looking around) never wins.
       */
      finalBeatSearchSec: 1.5,
    }),
  }),

  /**
   * Tempo profiles. 'relaxed' = the original pacing (planner defaults above);
   * 'snappy' = "bam-bam-bam": no dead air, lines start on the first frame, a
   * short neutral hold, quick hold → cut → stamp + quip → next shot.
   * The profile is chosen by spec `tempo` (default: `profile`).
   */
  tempo: Object.freeze({
    profile: 'snappy',
    profiles: Object.freeze({
      relaxed: Object.freeze({ voSpeed: 1, whoosh: false }),
      snappy: Object.freeze({
        /** Narrator lines/quips/hook play faster (atempo, pitch kept); the announcer is pre-sped. */
        voSpeed: 1.1,
        voSpeedRoles: Object.freeze(['narrator']),
        hookVoStartSec: 0,
        hookVoGapSec: 0.1,
        /** Rule line starts on the shot's first frame. */
        voLeadInSec: 0,
        /** Neutral (still) footage kept right before the action onset; the rest of the still part is cut. */
        neutralHoldSec: 0.5,
        /** Prelude motion ends where smoothed energy drops below valley + quietFraction·(prelude peak − valley). */
        quietFraction: 0.4,
        preludeLookbackSec: 3,
        /** The prelude action may play up to this fast to fill the line with real motion. */
        preludeMaxSpeed: 1.3,
        holdAfterFlashSec: 0.25,
        stampAfterCutSec: 0.1,
        /** Quip starts with the stamp (over the thud tail). */
        quipAfterStampSec: 0,
        cutAfterQuipSec: 0.15,
        resultMinHoldSec: 0.6,
        endCard: Object.freeze({
          voLeadInSec: 0,
          /** The stamp lands at the end of spec `endCard.stampAtPhrase` (locale text; real word timing), else at stampAtFraction of the line. */
          stampAtFraction: 0.6,
          tailSec: 0.3,
        }),
        whoosh: Object.freeze({ leadSec: 0.12, gain: 0.35 }),
      }),
    }),
  }),

  /** Spoken hook (spec hook.vo): starts at voStartSec; the first rule line starts ≥ voGapSec after it ends. */
  hook: Object.freeze({ voStartSec: 0.2, voGapSec: 0.25, titleTailSec: 0.3 }),

  /**
   * `tilted` end-card style: the subjects' perfect photos on a white 10×15
   * print sheet (2:3 portrait), 2×2 grid of 35×45 cells with cut lines and crop
   * marks, a slight rotation + drop shadow; slides/fades in over the dark card,
   * then the approve stamp lands on it. Below: logo row, CTA, hint. The entrance
   * and timing fields are shared by every grid style.
   */
  photoSheet: Object.freeze({
    /**
     * The sheet (the "group photo") takes the MAJORITY of the screen: a small
     * logo row at the top, the sheet as tall as fits (≤ maxWidthFrac of the
     * width), CTA + hint compact below. `ignoreBottomSafe`: the end card may
     * use the bottom platform-UI zone (accepted by the user) down to
     * bottomMarginPx; false keeps it inside layout.safeBottom.
     */
    ignoreBottomSafe: true,
    bottomMarginPx: 40,
    logoTopPx: 56,
    logoToSheetGapPx: 26,
    maxWidthFrac: 0.88,
    aspect: 2 / 3,
    marginPx: 40,
    gapPx: 26,
    cellAspect: 35 / 45,
    rotateDeg: -1.5,
    paper: '#ffffff',
    cutLine: '#d5d9df',
    cutLinePx: 2,
    cropMarkPx: 22,
    shadowBlur: 16,
    shadowOpacity: 0.45,
    /** Thin border per cell so white-background photos read as prints on white paper. */
    cellBorder: '#c9ced6',
    cellBorderPx: 2,
    /** Transparent padding around the sheet PNG (shadow + rotation). */
    padPx: 70,
    /** Entrance: fade + ease-out slide up from `slideDyPx` below over `inSec`. */
    inSec: 0.3,
    slideDyPx: 90,
    /**
     * Timing: the COMPLETE frame (sheet settled + approve stamp) must be on
     * screen for the whole announcer line. 'afterSheetIn' = stamp lands
     * stampAfterInSec after the sheet settles and the announcer starts
     * voAfterStampSec after the stamp; 'line' = the classic rule (stamp at the
     * phrase end / fraction of the line, VO from the first frame).
     */
    timing: 'afterSheetIn',
    stampAfterInSec: 0.15,
    voAfterStampSec: 0.05,
    /** Approve stamp across the sheet's bottom edge, clear of every face: width ∝ sheet, centre at a fraction of its height. */
    stampWidthFrac: 0.6,
    stampCenterFrac: 0.93,
    /** Stamp sticker aspect (height / width) after trimming — reserves its overhang below the sheet. */
    stampAspect: 0.5,
    /** Rows: fixed heights (text is centred within them), so sheet geometry never depends on text measurement. */
    logoIconPx: 64,
    logoWordmarkPx: 46,
    logoRowPx: 72,
    ctaRowPx: 112,
    hintRowPx: 52,
    ctaGapPx: 28,
    hintGapPx: 14,
  }),

  /**
   * Default end-card style (END_CARD_STYLE) when neither the campaign
   * (endCard.style) nor the kit (brand.json endCard.style) sets one. The grid
   * styles need one perfect photo per shot (4 shots); otherwise `classic`.
   *   'real-sheet' — print-sheet look, untilted: grey sheet, 2×2 photos, a brand
   *                  panel band below (header, QR, "before" thumbnail, URL, order line, tagline)
   *   'grid'       — grey sheet, 2×2 photos with black triangular crop marks only
   *   'grid-strip' — grid + a slim brand strip (icon, wordmark, URL)
   *   'tilted'     — white 10×15 sheet, slightly rotated (photoSheet above)
   *   'classic'    — logo, copy, CTA, stamp
   */
  endCardStyle: 'grid',
  printSheet: Object.freeze({
    widthFrac: 0.88,
    marginPx: 36,
    gapPx: 30,
    cellAspect: 35 / 45,
    cropMarkPx: 16,
    shadowBlur: 18,
    shadowOpacity: 0.5,
    /** Card rows (styles with a logo row). */
    logoTopPx: 56,
    logoRowPx: 72,
    logoToSheetGapPx: 30,
    topPxNoLogo: 70,
    ctaGapPx: 30,
    ctaRowPx: 112,
    hintGapPx: 12,
    hintRowPx: 52,
    bottomMarginPx: 40,
    /** The approve stamp straddles the photo grid's bottom edge: width ∝ sheet, height/width of the trimmed sticker. */
    stampWidthFrac: 0.58,
    stampAspect: 0.5,
    /** Per-style stamp override: with a brand band the stamp shrinks and moves right, clear of the left-aligned wordmark. */
    stampByStyle: Object.freeze({
      'real-sheet': Object.freeze({ widthFrac: 0.5, cxFrac: 0.7 }),
      'grid-strip': Object.freeze({ widthFrac: 0.5, cxFrac: 0.7 }),
    }),
    /** Brand panel (real-sheet) and strip (grid-strip). Colours: kit panelFrom/panelTo/panelMuted. */
    panel: Object.freeze({ heightPx: 470, headerPx: 104, footerPx: 120, qrPx: 220, beforePx: 220 }),
    /** Strip: icon + wordmark with the URL stacked under it, all left-aligned (the right side is the stamp's). */
    strip: Object.freeze({ heightPx: 124 }),
    /** Locale text (tagline, order line, QR URL, panel URL) comes from the spec/kit: endCard.sheet. */
    qr: Object.freeze({ logoFrac: 0.22 }),
  }),

  /**
   * Persistent brand bug (top-left, over the shots — not the end card). With a
   * kit chip (brand.json chip.file, e.g. a website-header screenshot) the chip
   * is used, rounded and shadowed; chip.iconBox, if set, is where the kit icon
   * is pasted crisply over a soft upscaled one. Without a chip: a drawn pill
   * (icon + wordmark).
   */
  brandBug: Object.freeze({
    chip: Object.freeze({
      heightPx: 68,
      radiusFrac: 0.22,
      opacity: 0.88,
    }),
    // Drawn pill (fallback):
    iconPx: 56,
    wordmarkPx: 36,
    gapPx: 12,
    /** Pill fill: kit colour `chipBg` (dark translucent reads on daylight footage and white stills alike). */
    chipPadXPx: 14,
    chipPadYPx: 10,
    /** Visible margin from the frame corner to the chip. */
    marginPx: 40,
    /** Soft drop shadow around the chip; the PNG carries this much transparent padding per side. */
    shadowPadPx: 16,
    shadowBlur: 6,
    shadowOpacity: 0.3,
  }),

  /**
   * `beat: "settle"` shots (no action — the animal goes still / poses): the
   * flash fires when the last motion settles: the last moment smoothed energy
   * is above tailFloor + fraction·(recent peak − tailFloor). If that motion is
   * too weak to trust (excess < minExcess, e.g. eyes-only), the anchor is
   * fallbackBeforeEndSec before the clip end. Measured: cow excess ~0.65 →
   * settle ~5.5 s; chameleon ~0.16 → fallback.
   */
  settle: Object.freeze({
    smoothSec: 0.25,
    tailSec: 1,
    searchSec: 3.5,
    fraction: 0.3,
    minExcess: 0.3,
    fallbackBeforeEndSec: 0.3,
    /** Stillness held after the flash before the cut (overrides the tempo's action hold). */
    holdSec: 0.4,
  }),

  /** ✗ / ✓ verdict marks — off by default (the stamp alone); spec `marks: true` enables. */
  marks: Object.freeze({ enabledByDefault: false }),

  endCard: Object.freeze({
    /** Minimum on-screen time; the card stretches to fit its audio. */
    defaultDurationSec: 3,
    /** Stamp time when the spec has no end-card VO line. */
    stampAtSec: 0.35,
    voLeadInSec: 0.25,
    stampAfterVoSec: 0.2,
    dingAfterClerkSec: 0.05,
    /** Ding after the thud when the clerk word is skipped. */
    dingAfterStampSec: 0.3,
    tailSec: 0.9,
    logoSize: 200,
    stampWidth: 640,
  }),

  /** Per-shot rule caption label (shot.caption) — off by default; spec `ruleCaptions: true` enables. */
  ruleCaptions: Object.freeze({ enabledByDefault: false }),

  captions: Object.freeze({
    /** Burned-in VO captions — off by default (platforms auto-caption); spec `captions: true` enables. */
    enabledByDefault: false,
    maxWords: 3,
    maxChars: 22,
    tailHoldSec: 0.25,
  }),

  offline: Object.freeze({
    /** Without macOS `say`, stand-in VO is silence of this reading speed. */
    silentCharsPerSec: 14,
    clipFps: 24,
    clipWidth: 720,
    clipHeight: 1280,
    flashAtSec: 0.2,
    flashFrames: 2,
    /** Injected action beats cycle through these, so the detector is exercised at several timings. */
    actionAtSec: Object.freeze([2.6, 2.2, 3.0, 2.4, 2.8]),
    burstSec: 0.4,
  }),
});

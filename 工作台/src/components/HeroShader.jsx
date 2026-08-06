import { ChromaFlow, FilmGrain, FlutedGlass, Shader, Swirl } from 'shaders/react';

/**
 * Bright paper cover backdrop — a GPU fluid-glass field on near-white.
 *
 * Layers run bottom-to-top: a slow swirl lays the tonal base, ChromaFlow
 * bends it around the cursor, fluted glass ribs refract the result, and a
 * film grain pass adds paper tooth so the field doesn't read as flat white.
 *
 * This is the "elevated" pass: the fluid field is kept quieter and softer
 * (lower momentum, wider radius, gentler contrast) so the standing CSS
 * gradient, soft glows and paper-nozzle vignette stay legible beneath the
 * type. The glass still tracks the cursor, but reads as a calm sheen over
 * a calm page rather than the hero itself.
 *
 * Loaded lazily and only where WebGPU exists (see Hero), so browsers
 * without it fall back to the flat paper field with no wasted bytes.
 */
export default function HeroShader() {
  return (
    <div className="lhero__shader-wrap">
      <Shader className="lhero__shader">
      {/* base wash: a slightly cooler, deeper tonal bed than before so the
          highlight ribs have something to catch */}
      <Swirl colorA="#f6f7fa" colorB="#e4e7ee" detail={1.6} />

      {/* the cursor wake is now wider and softer — an ambient sheen rather
          than a travelling blob. Colours step down one tonal band from the
          paper so the glass still refracts, never floods. */}
      <ChromaFlow
        blendMode="overlay"
        baseColor="#eef0f5"
        downColor="#cfd4de"
        leftColor="#e6e9f0"
        rightColor="#8f9aad"
        upColor="#fbfcfe"
        momentum={3}
        radius={3.2}
      />

      {/* finer, quieter glass ribs: lower refraction, higher frequency, so
          the sheen is a fine woven shimmer rather than heavy caustics */}
      <FlutedGlass
        aberration={0.35}
        angle={31}
        frequency={15}
        highlight={0.22}
        highlightSoftness={0.24}
        lightAngle={-90}
        refraction={2.4}
        shape="rounded"
        softness={0.9}
        speed={0.08}
      />

      {/* a whisper more paper tooth than the flat field needs */}
      <FilmGrain strength={0.16} />
      </Shader>
    </div>
  );
}

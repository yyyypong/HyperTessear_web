import { ChromaFlow, FilmGrain, FlutedGlass, Shader, Swirl } from 'shaders/react';

/**
 * Bright paper cover backdrop — a GPU fluid-glass field on near-white.
 *
 * Layers run bottom-to-top: a slow swirl lays the tonal base, ChromaFlow
 * bends it around the cursor, fluted glass ribs refract the result, and a
 * film grain pass adds paper tooth so the field doesn't read as flat white.
 *
 * Loaded lazily and only where WebGPU exists (see Hero), so browsers
 * without it fall back to the flat paper field with no wasted bytes.
 */
export default function HeroShader() {
  return (
    <div className="lhero__shader-wrap">
      <Shader className="lhero__shader">
      <Swirl colorA="#f7f8fa" colorB="#e8eaee" detail={1.45} />

      {/* momentum/radius kept low: the cursor wake stays restrained.
          Blended rather than stacked opaque — baseColor would otherwise
          flood the swirl beneath, leaving the glass nothing to refract.
          Greys stay a step darker than the paper so ribs still catch light. */}
      <ChromaFlow
        blendMode="overlay"
        baseColor="#f0f1f4"
        downColor="#c5cad3"
        leftColor="#e4e6eb"
        rightColor="#9aa3b2"
        upColor="#fafbfc"
        momentum={4}
        radius={2}
      />

      <FlutedGlass
        aberration={0.5}
        angle={31}
        frequency={12}
        highlight={0.28}
        highlightSoftness={0.18}
        lightAngle={-90}
        refraction={3.2}
        shape="rounded"
        softness={0.85}
        speed={0.1}
      />

      <FilmGrain strength={0.14} />
      </Shader>
    </div>
  );
}

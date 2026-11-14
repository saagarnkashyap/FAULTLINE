/** Original, decorative HUD geometry. It carries no simulated telemetry. */
export function NetworkBackdrop() {
  return <svg className="network-ambience" viewBox="0 0 1100 700" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs><radialGradient id="hud-vignette"><stop stopColor="var(--brand)" stopOpacity=".08" /><stop offset="1" stopColor="var(--graph)" stopOpacity="0" /></radialGradient>
      <pattern id="network-grid" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M28 0H0V28" fill="none" stroke="var(--border)" strokeWidth=".5" /></pattern>
      <pattern id="phosphor-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".5" fill="var(--text)" /></pattern>
    </defs>
    <rect className="network-grid" width="1100" height="700" fill="url(#network-grid)" opacity=".18" />
    <rect className="command-only phosphor-dots" width="1100" height="700" fill="url(#phosphor-dots)" opacity=".025" />
    <ellipse cx="550" cy="340" rx="520" ry="325" fill="url(#hud-vignette)" />
    <g className="terminal-plot" fill="none" stroke="var(--border-strong)" strokeWidth="1">
      <path d="M16 120V24H134M966 24H1084V120M16 580V676H134M966 676H1084V580" />
      <path d="M16 48H38M16 72H28M16 96H28M1062 48H1084M1072 72H1084M1072 96H1084M16 628H38M16 652H28M1062 628H1084M1072 652H1084" />
      <path d="M534 350H566M550 334V366" opacity=".25" />
      {Array.from({ length: 19 }, (_, index) => <path key={`x-${index}`} d={`M${55 + index * 55} 12v${index % 5 === 0 ? 11 : 5}M${55 + index * 55} 688v-${index % 5 === 0 ? 11 : 5}`} opacity=".5" />)}
      {Array.from({ length: 11 }, (_, index) => <path key={`y-${index}`} d={`M8 ${75 + index * 55}h${index % 5 === 0 ? 11 : 5}M1092 ${75 + index * 55}h-${index % 5 === 0 ? 11 : 5}`} opacity=".5" />)}
      <g className="plot-axis-labels" fill="var(--secondary)" stroke="none"><text x="1044" y="27">X</text><text x="23" y="350">Y</text></g>
    </g>
    <g className="network-orbits" fill="none" stroke="var(--brand)">
      <ellipse cx="550" cy="340" rx="510" ry="318" opacity=".19" />
      <ellipse cx="550" cy="340" rx="494" ry="304" opacity=".2" strokeDasharray="1 8" strokeWidth="3" />
      <ellipse cx="550" cy="340" rx="470" ry="289" opacity=".12" />
      <ellipse className="hud-arc" cx="550" cy="340" rx="500" ry="311" opacity=".32" strokeDasharray="70 350 24 900" strokeWidth="2" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <path key={index} opacity={.08 + index * .013} d={`M0 ${618 + index * 9} C130 ${530 + index * 16}, 180 ${730 - index * 7}, 370 ${625 + index * 9} S690 ${690 - index * 10}, 810 ${630 + index * 7} S990 ${680 - index * 9}, 1100 ${604 + index * 10}`} />)}
    </g>
  </svg>;
}

// Convert LaTeX / markdown-math into something a TTS engine reads naturally.
export function normalizeForSpeech(input: string): string {
  let s = input;
  // remove code fences
  s = s.replace(/```[\s\S]*?```/g, " (code block) ");
  // display math $$...$$ and \[...\]
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_m, x) => " " + latexToSpeech(x) + " ");
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, x) => " " + latexToSpeech(x) + " ");
  // inline math $...$ and \(...\)
  s = s.replace(/\$([^$\n]+)\$/g, (_m, x) => " " + latexToSpeech(x) + " ");
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, x) => " " + latexToSpeech(x) + " ");
  // markdown emphasis / headings / links
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Strip action tags, markdown source lists, raw URLs, and emoji so TTS sounds
  // human instead of saying "alarm clock", "brain", or reading links aloud.
  s = s.replace(/\[\[[\s\S]*?\]\]/g, " ");
  s = s.replace(/\*\*Sources:\*\*[\s\S]*$/i, " ");
  s = s.replace(/_No web sources[^.]*\./gi, " ");
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, " ");
  s = s.replace(/[*_`#>]+/g, "");
  s = s.replace(/[•|]/g, ", ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function latexToSpeech(tex: string): string {
  let t = tex;
  t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, " ($1) over ($2) ");
  t = t.replace(/\\sqrt\{([^{}]+)\}/g, " square root of ($1) ");
  t = t.replace(/\^\{([^{}]+)\}/g, " to the power of ($1) ");
  t = t.replace(/\^(\d+)/g, (_m, n) => n === "2" ? " squared " : n === "3" ? " cubed " : ` to the ${n} `);
  t = t.replace(/_\{([^{}]+)\}/g, " sub ($1) ");
  t = t.replace(/_(\w)/g, " sub $1 ");
  t = t.replace(/\\pi/g, " pi ");
  t = t.replace(/\\theta/g, " theta ");
  t = t.replace(/\\alpha/g, " alpha ");
  t = t.replace(/\\beta/g, " beta ");
  t = t.replace(/\\gamma/g, " gamma ");
  t = t.replace(/\\sum/g, " sum ");
  t = t.replace(/\\int/g, " integral ");
  t = t.replace(/\\infty/g, " infinity ");
  t = t.replace(/\\cdot/g, " times ");
  t = t.replace(/\\times/g, " times ");
  t = t.replace(/\\div/g, " divided by ");
  t = t.replace(/\\leq/g, " less than or equal to ");
  t = t.replace(/\\geq/g, " greater than or equal to ");
  t = t.replace(/\\neq/g, " not equal to ");
  t = t.replace(/\\approx/g, " approximately ");
  t = t.replace(/[{}\\]/g, " ");
  t = t.replace(/=/g, " equals ");
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/-/g, " minus ");
  t = t.replace(/\*/g, " times ");
  t = t.replace(/\//g, " over ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}
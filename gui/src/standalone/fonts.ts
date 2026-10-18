import latinNormal from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'
import latinExtNormal from '@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2'
import latinItalic from '@fontsource-variable/inter/files/inter-latin-wght-italic.woff2'
import latinExtItalic from '@fontsource-variable/inter/files/inter-latin-ext-wght-italic.woff2'

/**
 * Police Inter embarquée dans le fichier, sous le nom que citent les designs.
 *
 * Elle sert deux fois : à la page, et à chaque SVG rasterisé en PNG, qu'un
 * navigateur charge comme une image isolée, sans accès aux polices de la page.
 */

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD'
const LATIN_EXT =
  'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF'

function face(style: 'normal' | 'italic', url: string, range: string): string {
  return (
    `@font-face{font-family:'Inter';font-style:${style};font-weight:100 900;` +
    `src:url(${url}) format('woff2');unicode-range:${range};}`
  )
}

export const INTER_FONT_CSS = [
  face('normal', latinNormal, LATIN),
  face('normal', latinExtNormal, LATIN_EXT),
  face('italic', latinItalic, LATIN),
  face('italic', latinExtItalic, LATIN_EXT),
].join('')

export function installInterFont() {
  const style = document.createElement('style')
  style.textContent = INTER_FONT_CSS
  document.head.appendChild(style)
}

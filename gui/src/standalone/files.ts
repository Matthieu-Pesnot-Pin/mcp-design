/** Fait télécharger un fichier au navigateur. `href` : data URI ou URL de blob. */
export function downloadHref(name: string, href: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  downloadHref(name, url)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function downloadText(name: string, text: string, type: string) {
  downloadBlob(name, new Blob([text], { type }))
}

/** Octets d'un data URI base64. */
export function dataUriBytes(href: string): Uint8Array {
  const binary = atob(href.slice(href.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function copyText(text: string) {
  if (!navigator.clipboard) throw new Error("Le presse-papiers n'est pas accessible depuis cette page.")
  await navigator.clipboard.writeText(text)
}

/** "2026-10-17" */
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

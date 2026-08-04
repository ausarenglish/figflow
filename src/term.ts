const on = process.stdout.isTTY && !process.env.NO_COLOR

const ESC = String.fromCharCode(27)
const wrap = (code: string) => (text: string) => (on ? `${ESC}[${code}m${text}${ESC}[0m` : text)

export const dim = wrap('2')
export const green = wrap('32')
export const yellow = wrap('33')
export const bold = wrap('1')

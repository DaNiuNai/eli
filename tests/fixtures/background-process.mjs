import { writeFileSync } from 'node:fs'

writeFileSync(process.argv[2], String(process.pid))
console.log('后台进程已就绪')
console.error('stderr ready')
setInterval(() => console.log('working'), 1000)

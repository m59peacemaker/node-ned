#!/usr/bin/env node

const {spawn} = require('child_process')
const {join: joinPath} = require('path')
const program = require('commander')
const {watch} = require('chokidar')
const debounce = require('debounce')
const chalk = require('chalk')
const Promise = require('bluebird')
const exclusivePromise = require('exclusive-promise')
const prefix = require('prefix-stream-lines')

const args = program
  .command('dev')
  .arguments('[src] [dest]')
  .option('-m, --main', 'application entry point, relative to "dest" [index.js]', 'index.js')
  .option('-l, --lint', 'Lint code before execution')
  .option('-t, --test', 'Run tests')
  .option('-w, --watch', 'watch "src" directory and rebuild/restart app on change')
  .parse(process.argv)
args.main = args.main || 'index.js'

const srcDir = args.src || './src'
const destDir = args.dest || './build'

const prefixAndOutput = (label, p) => {
  p.stdout
    .pipe(prefix(label + ' | '))
    .pipe(process.stdout)
  p.stderr.pipe(process.stderr)
  return p
}

const makeFn = (cmd, spawnArgs, label) => {
  spawnArgs.push('--colors')
  return () => {
    const p = spawn(cmd, spawnArgs)
    prefixAndOutput(label, p)
    processes.push(p)
    return p
  }
}

let processes = []
const killAll = () => {
  const promises = processes.map(p => new Promise(resolve => {
    if (p.killed || p.exitCode !== null) {
      resolve()
    } else {
      p.on('close', resolve)
      p.kill()
    }
  }))
  processes = []
  return Promise.all(promises)
}

const lint = makeFn(require.resolve('ned-lint/bin/cmd'), [srcDir], chalk.magenta('lint'))
const maybeLint = () => new Promise((resolve, reject) => {
  if (args.lint) {
    lint().on('close', exitCode => exitCode ? reject() : resolve())
  } else {
    resolve()
  }
})

const transpile = makeFn(require.resolve('ned-transpile/bin/cmd'), [srcDir, destDir], chalk.cyan('transpile'))
const transpileAsync = () => new Promise((resolve, reject) => {
  transpile().on('close', exitCode => exitCode ? reject() : resolve())
})

const startApp = makeFn('node', [joinPath(destDir, args.main)], chalk.yellow('app'))

const test = makeFn(require.resolve('ned-test/bin/cmd'), ['-p', destDir], chalk.green('test'))
const maybeTest = () => new Promise((resolve, reject) => {
  if (args.test) {
    test().on('close', exitCode => exitCode ? reject() : resolve())
  } else {
    resolve()
  }
})

const run = () => {
  killAll()
  return Promise.resolve()
    .then(maybeLint)
    .then(transpileAsync)
    .then(startApp)
    .then(maybeTest)
    .catch(err => {
      err && console.error(err)
    })
}
const runExclusive = exclusivePromise(run)

const runExclusiveWithDivider = () => {
  console.log(`\n${'_'.repeat(process.stdout.columns * 2)}\n`)
  return runExclusive()
}

run()

if (args.watch) {
  watch(srcDir, {
    ignored: ['**/node_modules/**'],
    ignoreInitial: true
  }).on('all', debounce(runExclusiveWithDivider, 100))
}

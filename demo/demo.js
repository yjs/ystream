/* eslint-env browser */
import * as ydb from '@y/stream'
import * as wscomm from '@y/stream/comms/ws'
import * as authentication from '@y/stream/api/authentication'
import * as dbtypes from '@y/stream/api/dbtypes'
import * as Y from 'yjs'
import * as dom from 'lib0/dom'
import * as buffer from 'lib0/buffer'
import * as json from 'lib0/json'
import * as pair from 'lib0/pair'
import * as number from 'lib0/number'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as decoding from 'lib0/decoding'
// @ts-ignore
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { EditorView, basicSetup } from 'codemirror'
import { keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'

import * as random from 'lib0/random'
import { EditorState } from '@codemirror/state'

const testUserRaw = {
  privateKey: '{"key_ops":["sign"],"ext":true,"kty":"EC","x":"pAUmLYc-UFmPIt7leafPTbhxQyygcaW7__nPcUNCuu0wH27yS9P_pWFP1GwcsoAN","y":"u3109KjrPGsNUn2k5Whn2uHLAckQPdLNqtM4GpBEpUJwlvVDvk71-lS3YOEYJ_Sq","crv":"P-384","d":"OHnRw5an9hlSqSKg966lFRvB7dow669pVSn7sFZUi7UQh_Y9Xc95SQ6pEWsofsYD"}',
  user: 'AMgBeyJrZXlfb3BzIjpbInZlcmlmeSJdLCJleHQiOnRydWUsImt0eSI6IkVDIiwieCI6InBBVW1MWWMtVUZtUEl0N2xlYWZQVGJoeFF5eWdjYVc3X19uUGNVTkN1dTB3SDI3eVM5UF9wV0ZQMUd3Y3NvQU4iLCJ5IjoidTMxMDlLanJQR3NOVW4yazVXaG4ydUhMQWNrUVBkTE5xdE00R3BCRXBVSndsdlZEdms3MS1sUzNZT0VZSl9TcSIsImNydiI6IlAtMzg0In0='
}

const testServerUser = 'AMgBeyJrZXlfb3BzIjpbInZlcmlmeSJdLCJleHQiOnRydWUsImt0eSI6IkVDIiwieCI6IkNZd01ha3BuMG9uYU5lQ2Etd3FMbjRGenNyaXNfVVk0WjVnUlFVQTl4UU9vaDk0WUc5T0hoSXRyNnJvdmFZcFoiLCJ5IjoiNzRVbGp1ODZJVU1KWnNZc1NqeFNqdXNMamo5VTZyb3pad2JLOVhhcWozTWdJV3Ruak55akwxRC1Oek9QM0ZKNyIsImNydiI6IlAtMzg0In0='

const testUser = {
  privateKey: await ecdsa.importKeyJwk(json.parse(testUserRaw.privateKey)),
  user: dbtypes.UserIdentity.decode(decoding.createDecoder(buffer.fromBase64(testUserRaw.user)))
}
const owner = buffer.toBase64(testUser.user.hash)

const collection = 'my-notes-app'
const y = await ydb.openYdb('wss://localhost:3000', {
  comms: [new wscomm.WebSocketComm('ws://localhost:9000', [{ owner, collection }])]
})

await authentication.registerUser(y, dbtypes.UserIdentity.decode(decoding.createDecoder(buffer.fromBase64(testServerUser))), { isTrusted: true })
await authentication.setUserIdentity(y, testUser.user, await testUser.user.publicKey, testUser.privateKey)

const ycollection = y.getCollection(owner, collection)
const yroot = ycollection.getYdoc('index')
const ynotes = yroot.getArray('notes')

// add some css
dom.appendChild(document.head || document.body, dom.element('style', [], [dom.text(`
body {
  display: flex;
  margin: 0;
}
body, html {
  height: 100%;
}
.sidebar {
  width: 300px;
  padding: .4em;
  margin-top: 1em;
  padding-left: .9em;
}
.sidebar > * {
  margin: .3em 0;
}
#content {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
}
#content > .docname {
  font-size: x-large;
  font-weight: bold;
  border: none;
  outline: none;
  margin-top: 1em;
}
.editor {
  flex-grow: 1;
}
.cm-editor {
  height: 100%;
}
.notes-list {
  padding: 0;
  margin: 0;
  overflow-y: scroll;
  max-height: 400px;
}
.notes-list > li {
  display: block;
  padding: 5px;
  cursor: pointer;
}
.notes-list > li:hover {
  text-decoration: underline;
}
`)]))

const notesList = dom.element('ul', [pair.create('class', 'notes-list')])
notesList.addEventListener('click', event => {
  const target = /** @type {HTMLElement?} */ (event.target)
  const docid = target?.getAttribute('ydoc')
  const i = target?.getAttribute('i')
  if (docid && i) {
    openDocumentInCodeMirror(docid, ynotes.get(number.parseInt(i)))
  }
})

/**
 * @param {number} n
 */
const createNotes = n => {
  const notes = []
  for (let i = 0; i < n; i++) {
    const ynote = new Y.Map()
    const ynoteContent = ycollection.getYdoc(`#${ynotes.length + i}`)
    ynoteContent.getText().insert(0, `# Note #${ynotes.length + i}\nsome initial content`)
    ynote.set('name', `Note #${ynotes.length + i}`)
    ynote.set('content', ynoteContent)
    notes.unshift(ynote)
  }
  ynotes.insert(0, notes)
}

const newNoteElement = dom.element('button', [], [dom.text('Create Note')])

newNoteElement.addEventListener('click', () => createNotes(1))

const new100NotesElement = dom.element('button', [], [dom.text('Create 100 Notes')])
new100NotesElement.addEventListener('click', () => createNotes(100))

// sidebar
dom.appendChild(document.body, dom.element('div', [pair.create('class', 'sidebar')], [
  // user info
  dom.element('details', [], [
    dom.element('summary', [], [dom.text('User Details')]),
    dom.element('label', [], [
      dom.text('hash'),
      dom.element('input', [pair.create('type', 'text'), pair.create('value', 'abcde'), pair.create('disabled', true)])
    ])
  ]),
  dom.element('details', [pair.create('open', true)], [
    dom.element('summary', [], [dom.text('Notes')]),
    newNoteElement,
    new100NotesElement,
    notesList
  ])
]))

const renderNotes = () => {
  notesList.innerHTML = ynotes.toArray().map((ynote, i) => `<li i="${i}" ydoc="${ynote.get('content').guid}">${ynote.get('name') || '&lt;unnamed&gt;'}</li>`).join('')
}

const editorDiv = dom.element('div', [pair.create('class', 'editor')])
const editorDocnameInput = /** @type {HTMLInputElement} */ (dom.element('input', [pair.create('type', 'text'), pair.create('placeholder', 'Document name'), pair.create('class', 'docname')]))
dom.appendChild(document.body, dom.element('div', [pair.create('id', 'content')], [
  editorDocnameInput,
  editorDiv
]))

ynotes.observeDeep(renderNotes)

export const usercolors = [
  { color: '#30bced', light: '#30bced33' },
  { color: '#6eeb83', light: '#6eeb8333' },
  { color: '#ffbc42', light: '#ffbc4233' },
  { color: '#ecd444', light: '#ecd44433' },
  { color: '#ee6352', light: '#ee635233' },
  { color: '#9ac2c9', light: '#9ac2c933' },
  { color: '#8acb88', light: '#8acb8833' },
  { color: '#1be7ff', light: '#1be7ff33' }
]

export const userColor = usercolors[random.uint32() % usercolors.length]

// provider.awareness.setLocalStateField('user', {
//   name: 'Anonymous ' + Math.floor(Math.random() * 100),
//   color: userColor.color,
//   colorLight: userColor.light
// })

/**
 * @type {{view: EditorView, ydoc: Y.Doc, unregisterHandlers: function():void} | null}
 */
let currentEditorState = null

/**
 * @param {string} ydocname
 * @param {Y.Map<any>} yprops
 */
const openDocumentInCodeMirror = (ydocname, yprops) => {
  currentEditorState?.unregisterHandlers()
  currentEditorState?.view.destroy()
  currentEditorState?.ydoc.destroy()
  const ydoc = ycollection.getYdoc(ydocname)
  const ytext = ydoc.getText()
  const state = EditorState.create({
    doc: ytext.toString(),
    extensions: [
      keymap.of([
        ...yUndoManagerKeymap
      ]),
      basicSetup,
      markdown(),
      EditorView.lineWrapping,
      yCollab(ytext/* , provider.awareness */)
      // oneDark
    ]
  })
  const view = new EditorView({ state, parent: editorDiv })
  const inputEventHandler = () => {
    const newName = editorDocnameInput.value
    if (yprops.get('name') !== newName && newName !== '<unnamed>') {
      yprops.set('name', newName)
    }
  }
  editorDocnameInput.addEventListener('input', inputEventHandler)
  const updateName = () => {
    editorDocnameInput.value = yprops.get('name')
  }
  yprops.observe(updateName)
  updateName()
  const unregisterHandlers = () => {
    yprops.unobserve(updateName)
    editorDocnameInput.removeEventListener('input', inputEventHandler)
  }
  currentEditorState = { view, ydoc, unregisterHandlers }
  // @ts-ignore
  window.demo.editorState = currentEditorState
}

// @ts-ignore
window.demo = { editorState: null, yroot }

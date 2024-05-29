'use client'
import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import * as Y from 'yjs'
import { yCollab } from 'y-codemirror.next'
import { javascript } from '@codemirror/lang-javascript'
import Filetree from './components/filetree'

function Editor ({ ydoc }: { ydoc: Y.Doc | null }) {
  if (ydoc === null) return <div />
  return (
    <CodeMirror extensions={[javascript(), yCollab(ydoc.getText(), null)]}/>
  )
}

export default function Home () {
  const [ydoc, setYdoc] = useState(null as Y.Doc | null)
  return <div id="main">
    <Filetree onDocSelection={setYdoc}/>
    <Editor ydoc={ydoc}/>
  </div>
}

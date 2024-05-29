import { useEffect, useState } from 'react'
import {
  Tree,
  CreateHandler,
  DeleteHandler,
  NodeApi,
  NodeRendererProps,
  RenameHandler,
} from "react-arborist"
import * as icons from 'react-icons/md'
import { BsTree } from "react-icons/bs";
import * as Y from 'yjs'
import * as promise from 'lib0/promise'
import * as random from 'lib0/random'
import thePromisedYstream from '../ystream'


export default function Filetree ({ onDocSelection }: { onDocSelection: (ydoc: Y.Doc|null) => void }) {
  const [fileTree, setFileTree] = useState([] as Array<any>)
  const [docid, setDocId] = useState(null as string|null)

  useEffect(() => {
    const updateFileTree = () => thePromisedYstream.then(({ y, ycollection }) => {
      y.transact(async tr => {
        const tree = await ycollection.getDocChildrenRecursive(tr, null)
        const mapper = async (node: any) => {
          const isFolder = node.children.length > 0 || (await ycollection.getFileInfo(tr, node.docid))?.ftype === 'dir'
          return {
            id: node.docid,
            name: node.docname,
            readOnly: false,
            editable: true,
            children: isFolder ? (await promise.all(node.children.map(mapper))) : null
          }
        }
        const filetree = await promise.all(tree.map(mapper))
        setFileTree(filetree)
      })
    })
    updateFileTree()
    thePromisedYstream.then(({ y }) => {
      y.on('ops', updateFileTree)
    })
    return () => {
      thePromisedYstream.then(({ y }) => {
        y.off('ops', updateFileTree)
      })
    }
  }, [])

  useEffect(() => {
    if (docid === null) { return }
    onDocSelection(null)
    // bind new ydoc to ycollection doc
    const promisedYdoc = thePromisedYstream.then(({ ycollection }) => {
      const ydoc = ycollection.getYdoc(docid)
      onDocSelection(ydoc)
      return ydoc
    })
    return () => {
      promisedYdoc.then(ydoc => { ydoc.destroy() })
    }
  }, [docid])

  const onCreateFile: CreateHandler<any> = async (node) => {
    console.log(node)
    return thePromisedYstream.then(async ({ y, ycollection }) => {
      const res = await y.transact(async tr => {
        const newNoteId = random.uuidv4()
        await ycollection.setFileInfo(tr, random.uuidv4(), `new-note#${Math.random().toString(32).slice(2)}.md`, node.parentId, 'text')
        return { id: newNoteId }
      })
      await promise.wait(300)
      return res
    })
  }

  const onDeleteFile: DeleteHandler<any> = async (event) => {
    await thePromisedYstream.then(async ({ y, ycollection }) => {
      await y.transact(async tr => {
        await promise.all(event.ids.map(docid =>
          ycollection.deleteDoc(tr, docid)
        ))
      })
    })
  }

  const onRename: RenameHandler<any> = async (node) => {
    const { y, ycollection } = await thePromisedYstream
    await y.transact(async tr => {
      const parentNode = node.node.parent
      const parentid = (parentNode?.level ?? -1) >= 0 ? parentNode?.id ?? null: null
      const newid = random.uuidv4()
      const oldContent = await ycollection.getYdocUpdates(tr, node.id)
      await ycollection.addYdocUpdate(tr, newid, Y.mergeUpdatesV2(oldContent || []))
      await ycollection.setFileInfo(tr, newid, node.name, parentid, 'text')
      // delete old doc
      await ycollection.deleteDoc(tr, node.id)
    })
  }

  const onActivate = (node: NodeApi<any>) => {
    if(node.children === null) setDocId(node.id)
  }

  return (
    <div>
      <Tree data={fileTree} disableEdit={false} onActivate={onActivate} onCreate={onCreateFile} onDelete={onDeleteFile} onRename={onRename}>
        {Node}
      </Tree>
    </div>
  )
}

function Node({ node, style, dragHandle }: NodeRendererProps<any>) {
  const Icon = node.data.icon || BsTree;
  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={() => node.isInternal && node.toggle()}
    >
      <FolderArrow node={node} />
      <span>
        <Icon />
      </span>
      <span>{node.isEditing ? <Input node={node} /> : node.data.name}</span>
    </div>
  );
}

function Input({ node }: { node: NodeApi }) {
  return (
    <input
      autoFocus
      type="text"
      defaultValue={node.data.name}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => node.reset()}
      onKeyDown={(e) => {
        if (e.key === "Escape") node.reset();
        if (e.key === "Enter") node.submit(e.currentTarget.value);
      }}
    />
  );
}

function FolderArrow({ node }: { node: NodeApi }) {
  if (node.isLeaf) return <span></span>;
  return (
    <span>
      {node.isOpen ? <icons.MdArrowDropDown /> : <icons.MdArrowRight />}
    </span>
  );
}

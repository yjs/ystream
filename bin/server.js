import { createWSServer } from '../src/comms/websocket-server.js'
import * as json from 'lib0/json'
import * as buffer from 'lib0/buffer'
import * as decoding from 'lib0/decoding'
import * as ecdsa from 'lib0/crypto/ecdsa'
import * as dbtypes from '../src/dbtypes.js'

// @todo this seriously should live somewhere else!
const testServerIdentityRaw = {
  privateKey: '{"key_ops":["sign"],"ext":true,"kty":"EC","x":"CYwMakpn0onaNeCa-wqLn4Fzsris_UY4Z5gRQUA9xQOoh94YG9OHhItr6rovaYpZ","y":"74Ulju86IUMJZsYsSjxSjusLjj9U6rozZwbK9Xaqj3MgIWtnjNyjL1D-NzOP3FJ7","crv":"P-384","d":"-yKNOty9EshGL0yAOQ2q6c_b_PNCpeEK9FVPoB0wc9EUyt9BR4DZuqrC9t_DgNaF"}',
  user: 'AMgBeyJrZXlfb3BzIjpbInZlcmlmeSJdLCJleHQiOnRydWUsImt0eSI6IkVDIiwieCI6IkNZd01ha3BuMG9uYU5lQ2Etd3FMbjRGenNyaXNfVVk0WjVnUlFVQTl4UU9vaDk0WUc5T0hoSXRyNnJvdmFZcFoiLCJ5IjoiNzRVbGp1ODZJVU1KWnNZc1NqeFNqdXNMamo5VTZyb3pad2JLOVhhcWozTWdJV3Ruak55akwxRC1Oek9QM0ZKNyIsImNydiI6IlAtMzg0In0='
}

const testServerIdentity = {
  privateKey: await ecdsa.importKeyJwk(json.parse(testServerIdentityRaw.privateKey)),
  user: dbtypes.UserIdentity.decode(decoding.createDecoder(buffer.fromBase64(testServerIdentityRaw.user)))
}

export const server = await createWSServer({
  identity: testServerIdentity
})

import express from 'express'
import morgan from 'morgan'
import { promises as fsPromises, existsSync } from 'fs'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import cors from 'cors'
import dotenv from 'dotenv'
import fetch from 'node-fetch'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const app = express()
const PORT = process.env.PORT ?? 3000
const TIMEOUT = process.env.TIMEOUT ?? 30000
const SERVER_NAME = process.env.SERVER_NAME


// Setup logging
app.use(morgan(`dev`))

// To handle body parsing
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const storageDir = path.join(__dirname, `storage`)
if (!existsSync(storageDir)) {
    fsPromises.mkdir(storageDir, { recursive: true }).catch(console.error)
}

app.use(cors())

async function createFile(req)  {
    console.log(`${SERVER_NAME}${req.url}`)
    const localFilePath = path.join(storageDir, encodeURIComponent(req.url))
    const timeout = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Request timed out after ${TIMEOUT} milli-seconds`))
        }, TIMEOUT)
    })

    const response = await Promise.race([
        fetch(`${SERVER_NAME}${req.url}`),
        timeout
    ]).catch(() => {
        return {ok: false, status: 408}
    })
    if (!response.ok) {
        return response.status
    }

    let arrayBuffer = await response.arrayBuffer()
    let buffer = Buffer.from(arrayBuffer)

    // 由于 TBC 和 WLK 版本的头盔遮盖数据错误, 这里用 classic 版本的去做修复.
    if (/\/modelviewer\/(?:tbc|wrath)\/meta\/armor\/1\/\d+\.json/.test(req.url)) {
        buffer = await tryFixHelmCoverage(req.url, buffer)
    }

    await fsPromises.writeFile(localFilePath, buffer)
    return false
}

async function tryFixHelmCoverage(url, buffer) {
    let text = buffer.toString('utf8')
    if (!text.includes('HideGeosetMale')) {
        return buffer
    }

    let classicURL = url.replace(/\/modelviewer\/(?:tbc|wrath)/, '/modelviewer/classic')
    let id = Number(url.match(/(\d+)\.json$/)[1])
    let shouldClear = false

    if ([
        15372,
        16043,
        33278,
        34703,
        35604,
        37347,
        37295,
        38591,
        36385,
        46190,
        48209,
        49042,
        49699,
        50790,
        44383,
        52549,
        10018,
        53792,
        54831,
        55061,
        39959,
        37834,
        61029,
        61033,
        60138,
        23327,
        55053,
        46976,
        14908,
    ].includes(id)) {
        shouldClear = true
    }
    else {
        let timeout = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Request timed out after ${TIMEOUT} milli-seconds`))
            }, TIMEOUT)
        })

        let classicResponse = await Promise.race([
            fetch(`${SERVER_NAME}${classicURL}`),
            timeout
        ]).catch(() => {
            return {ok: false, status: 408}
        })

        if (!classicResponse.ok) {
            return buffer
        }

        let classicText = await classicResponse.text()
        let classicJson = JSON.parse(classicText)
        shouldClear = !classicJson?.Item?.HideGeosetMale
    }

    if (shouldClear) {
        let json = JSON.parse(text)
        if (json.Item) {
            json.Item.HideGeosetMale = null
            json.Item.HideGeosetFemale = null
        }

        buffer = Buffer.from(JSON.stringify(json))
    }

    return buffer
}

app.use(`/`, async (req, res, next) => {
    const localFilePath = path.join(storageDir, encodeURIComponent(req.url))
    if (!existsSync(localFilePath)) {
        const err = await createFile(req)
        if (err) {
            console.warn(`Error ${err} on ${SERVER_NAME}${req.url}`)
            res.status(err)
            return next(err)
        }
    }
    // Respond with the file
    res.sendFile(localFilePath)
})

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`)
})

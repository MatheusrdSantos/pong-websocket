const express = require('express')
const app = express()
const http = require('http')
const server = http.createServer(app)
const { Server: IOServer } = require('socket.io')
const io = new IOServer(server)

app.use(express.static('public'))

const sleep = ms => new Promise(r => setTimeout(r, ms))
// px per second
const BALL_SPEED = 400
const PADDLE_HEIGHT = 70
const PADDLE_WIDTH = 10
const CANVAS_WIDTH = 600
const CANVAS_HEIGHT = 400


const generateInitVector = () => {
  // angle between 0 and 45 degrees
  const angle = Math.random() * (Math.PI / 4)
  return {
    x: Math.cos(angle) * Math.sign(Math.random() - 0.5),
    y: Math.sin(angle) * Math.sign(Math.random() - 0.5)
  }
}

// vector dot product
const dot = (v1, v2) => v1.x*v2.x + v1.y*v2.y

// normalize a vector
const normalize = (v) => {
  // to normalize a vector, divide the vector by its magnitude
  const m = Math.sqrt(v.x ** 2 + v.y ** 2)
  return {
    x: v.x / m,
    y: v.y / m,
  }
}

// how to compute the bouncing
// https://stackoverflow.com/questions/61272597/calculate-the-bouncing-angle-for-a-ball-point
const computeBallCollision = () => {
  const { ball, p1, p2 } = gameState
  // ball collide with top or bot walls
  if(ball.y <= 0 || ball.y >= CANVAS_HEIGHT) {
    // moves the ball back to a valid position
    ball.y = Math.min(Math.max(ball.y, 0), CANVAS_HEIGHT)
    const normal = { x: 0, y: 1 }
    ball.vec.y = -2 * dot(ball.vec, normal) * normal.y + ball.vec.y
    ball.vec = normalize(ball.vec)
  // ball collide with left / right walls, in this case a player scored
  } else if (ball.x >= CANVAS_WIDTH || ball.x <= 0) {
    ball.x >= CANVAS_WIDTH ? p1.score += 1 : p2.score += 1
    ball.reset()
    io.emit('scoreChange', { p1: p1.score, p2: p2.score })
    io.emit('newRound', ball)
  // compute collision with paddles
  } else if (
    // collision with left paddle
    ball.x <= PADDLE_WIDTH && p1.y <= ball.y && ball.y <= p1.y + PADDLE_HEIGHT ||
    // collision with right paddle  
    ball.x >= CANVAS_WIDTH - PADDLE_WIDTH && p2.y <= ball.y && ball.y < p2.y + PADDLE_HEIGHT 
    ) {
    // moves the ball back to a valid position
    ball.x = Math.min(Math.max(ball.x, PADDLE_WIDTH), CANVAS_WIDTH - PADDLE_WIDTH)
    const normal = { x: 1, y: 0 }
    ball.vec.x = -2 * dot(ball.vec, normal) * normal.x + ball.vec.x
    ball.vec = normalize(ball.vec)
  }
}

const gameState = {
  p1: {
    y: (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2,
    score: 0,
    socketId: undefined
  },
  p2: {
    y: (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2,
    score: 0,
    socketId: undefined
  },
  ball: {
    x: 300,
    y: 200,
    vec: generateInitVector(),
    reset: function () {
      this.x = 300
      this.y = 200
      this.vec = generateInitVector()
    }
  },
  /**
   * reset the game
   */
  reset: function () {
    this.p1.y = (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2
    this.p1.score = 0

    this.p2.y = (CANVAS_HEIGHT - PADDLE_HEIGHT) / 2
    this.p2.score = 0

    this.ball.x = 300
    this.ball.y = 200
    this.ball.vec = generateInitVector()
  },
  nextFrame: async function (lastCall) {
    computeBallCollision()
    const delta = Date.now() - lastCall
    this.ball.x += this.ball.vec.x * (delta / 1000) * BALL_SPEED
    this.ball.y += this.ball.vec.y * (delta / 1000) * BALL_SPEED
    io.emit('ballMove', { x: this.ball.x, y: this.ball.y })
  },
  start: function () {
    io.emit('gameStart', { x: this.ball.x, y: this.ball.y })
    return new Promise(async (resolve) => {
      let lastFrame = Date.now()
      while(this.p1.score < 7 && this.p2.score < 7) {
        const start = Date.now()
        await this.nextFrame(lastFrame)
        const end = Date.now()
        lastFrame = end
        // max 100 fps
        await sleep(Math.max(Math.floor(1000 / 100) - (end - start), 1))
      }
      io.emit('gameEnd', this.p1.score > this.p2.score ? 1 : 2)
      resolve()
    })
    
  },
  /** 
   * attach a socket to an available player
   * @param {import('socket.io').Socket} socket
  */
  addSocket: function (socket) {
    const player = this.p1.socketId === undefined 
      ? this.p1 
      : this.p2.socketId === undefined 
        ? this.p2 
        : undefined
    if (!player) return
    player.socketId = socket.id
    socket.on('move', (y) => {
      player.y = y
      socket.broadcast.emit('updatePaddle', y)
    })
    socket.on('restartGame', () => {
      this.reset()
      this.start()
      io.emit('gameStart', this.ball)
    })
    socket.emit('playerSelected', player === this.p1 ? 1 : 2)
    if (this.p1.socketId && this.p2.socketId) this.start()
  }
}

io.on('connection', (socket) => {
  socket.on('disconnect', () => {
    console.log('user disconnected', socket.id)
  })
  
  if (gameState.p1.socketId && gameState.p2.socketId) {
    socket.disconnect(true)
    // TODO: show disconnect message on client
    return
  }
  gameState.addSocket(socket)
  console.log('a user connected', socket.id)
})

server.listen(3000, () => {
  console.log('listening on *:3000')
})

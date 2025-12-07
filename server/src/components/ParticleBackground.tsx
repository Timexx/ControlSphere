'use client'

import { useEffect, useRef, useCallback } from 'react'

interface Particle {
  x: number
  y: number
  baseX: number
  baseY: number
  angle: number
  speed: number
  radius: number
  size: number
  alpha: number
  pulse: number
  pulseSpeed: number
}

export default function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const animationRef = useRef<number>(0)
  const mouseRef = useRef({ x: -1000, y: -1000 })
  const timeRef = useRef(0)

  const initParticles = useCallback((width: number, height: number) => {
    // Calculate optimal grid for even distribution
    const totalParticles = Math.min(600, Math.floor((width * height) / 3000))
    const cols = Math.ceil(Math.sqrt(totalParticles * (width / height)))
    const rows = Math.ceil(totalParticles / cols)
    const cellWidth = width / cols
    const cellHeight = height / rows
    
    const particles: Particle[] = []
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        // Each particle anchored to center of its cell with small random offset
        const baseX = col * cellWidth + cellWidth / 2 + (Math.random() - 0.5) * cellWidth * 0.3
        const baseY = row * cellHeight + cellHeight / 2 + (Math.random() - 0.5) * cellHeight * 0.3
        
        particles.push({
          x: baseX,
          y: baseY,
          baseX,
          baseY,
          angle: Math.random() * Math.PI * 2,
          speed: 0.0003 + Math.random() * 0.0004, // Slow orbital speed
          radius: 15 + Math.random() * 25, // Orbital radius
          size: 0.6 + Math.random() * 0.8, // Small particles
          alpha: 0.15 + Math.random() * 0.2,
          pulse: Math.random() * Math.PI * 2,
          pulseSpeed: 0.001 + Math.random() * 0.002,
        })
      }
    }

    particlesRef.current = particles
  }, [])

  const updateParticles = useCallback(
    (width: number, height: number, deltaTime: number) => {
      const particles = particlesRef.current
      const mouse = mouseRef.current
      timeRef.current += deltaTime

      particles.forEach((p) => {
        // Smooth orbital motion around base position
        p.angle += p.speed * deltaTime
        p.pulse += p.pulseSpeed * deltaTime
        
        // Calculate orbital position
        const orbitX = Math.cos(p.angle) * p.radius
        const orbitY = Math.sin(p.angle * 0.7) * p.radius * 0.6 // Elliptical orbit
        
        // Target position is base + orbit
        const targetX = p.baseX + orbitX
        const targetY = p.baseY + orbitY
        
        // Smooth interpolation to target
        p.x += (targetX - p.x) * 0.02
        p.y += (targetY - p.y) * 0.02

        // Mouse interaction - gentle push away
        const mdx = p.x - mouse.x
        const mdy = p.y - mouse.y
        const mouseDist = Math.sqrt(mdx * mdx + mdy * mdy)
        const mouseRadius = 120

        if (mouseDist < mouseRadius && mouseDist > 0) {
          const force = Math.pow((mouseRadius - mouseDist) / mouseRadius, 2) * 15
          p.x += (mdx / mouseDist) * force
          p.y += (mdy / mouseDist) * force
        }

        // Pulsing alpha for magical shimmer
        const shimmer = Math.sin(p.pulse) * 0.08 + Math.sin(p.pulse * 2.3) * 0.04
        p.alpha = Math.max(0.08, Math.min(0.4, 0.18 + shimmer))
      })
    },
    []
  )

  const drawParticles = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.clearRect(0, 0, width, height)

      const particles = particlesRef.current

      // Draw ethereal connections
      ctx.lineWidth = 0.3
      
      for (let i = 0; i < particles.length; i++) {
        const p1 = particles[i]
        
        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j]
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          const maxDist = 100

          if (dist < maxDist) {
            // Gradient connection with cyan tint
            const alpha = Math.pow(1 - dist / maxDist, 2) * 0.08
            const gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y)
            gradient.addColorStop(0, `rgba(0, 200, 255, ${alpha * 0.5})`)
            gradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha})`)
            gradient.addColorStop(1, `rgba(0, 200, 255, ${alpha * 0.5})`)
            
            ctx.strokeStyle = gradient
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.stroke()
          }
        }
      }

      // Draw particles with glow
      particles.forEach((p) => {
        // Outer glow - cyan tint
        const glowSize = p.size * 6
        const glowGradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowSize)
        glowGradient.addColorStop(0, `rgba(0, 220, 255, ${p.alpha * 0.3})`)
        glowGradient.addColorStop(0.4, `rgba(100, 200, 255, ${p.alpha * 0.1})`)
        glowGradient.addColorStop(1, 'rgba(0, 150, 255, 0)')

        ctx.fillStyle = glowGradient
        ctx.beginPath()
        ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2)
        ctx.fill()

        // Core particle - bright white
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * 1.5})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
        ctx.fill()

        // Inner highlight
        ctx.fillStyle = `rgba(255, 255, 255, ${p.alpha * 2})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2)
        ctx.fill()
      })

      // Add subtle vignette overlay for depth
      const vignette = ctx.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, Math.max(width, height) * 0.7
      )
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.15)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, width, height)
    },
    []
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      initParticles(canvas.width, canvas.height)
    }

    resize()
    window.addEventListener('resize', resize)

    // Smooth mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('mousemove', handleMouseMove)

    // Animation loop
    let lastTime = performance.now()

    const animate = (currentTime: number) => {
      const deltaTime = currentTime - lastTime
      lastTime = currentTime

      updateParticles(canvas.width, canvas.height, deltaTime)
      drawParticles(ctx, canvas.width, canvas.height)

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animationRef.current)
    }
  }, [initParticles, updateParticles, drawParticles])

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ background: 'transparent' }}
    />
  )
}

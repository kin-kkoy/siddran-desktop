import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styles from './Auth.module.css'
import logger from '../../utils/logger'

function LoginPage({ setIsAuthed, setAppUsername, onTryDemo }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')

    // char char or design purposes
    const [loading, setLoading] = useState('')

    const navigate = useNavigate()
    const API = import.meta.env.VITE_API_URL || 'http://localhost:3000' 


    // Enter the ephemeral guest demo: sets up the in-memory backend (in App) then
    // navigates into the app. Nothing is persisted; a refresh returns here.
    const tryDemo = () => {
        onTryDemo?.()
        navigate('/notes')
    }

    const login = async () => {
        if(!username.trim() || !password.trim()){
            setError('Username & Password required')
            return
        }

        setLoading(true)
        setError('')

        try {
            const res = await fetch(`${API}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',// THIS ALLOWS US TO SEND/RECIEVE COOKIES
                body: JSON.stringify({ username, password })
            })

            const data = await res.json();

            if(!res.ok) throw new Error (data.error || 'Login failed')

            // if loggin in worked well, store the obtained token
            localStorage.setItem(`accessToken`, data.accessToken)

            const payload = JSON.parse(atob(data.accessToken.split('.')[1]))
            setAppUsername(payload.username)

            setIsAuthed(true)

            // then redirect
            navigate('/notes')

        } catch (error) {
            logger.error('Login error:', error)
            setError(error.message || 'Something went wrong when trying to login')
        }finally{
            setLoading(false)
        }
    }

    return (
        <div className={styles.authContainer}>
            <div className={styles.authCard}>

                <div className={styles.authHeader}>
                    <h1 className={styles.authTitle}>Sign In</h1>
                </div>


                {error && <div className={styles.authError}>{error}</div>}


                <div className={styles.authForm}>

                    {/* username input field */}
                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>Username</label>
                        <input 
                            type="text" 
                            className={styles.formInput}
                            placeholder="Enter your username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            onFocus={e => e.target.select()}
                        />
                    </div>

                    {/* password input field */}
                    <div className={styles.formGroup}>
                        <label className={styles.formLabel}>Password</label>
                        <input
                            className={styles.formInput}
                            type='password' 
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            onFocus={e => e.target.select()}
                            onKeyDown={e =>{
                                if(e.key === "Enter") login()
                            }}
                        />
                    </div>

                    <button
                        className={styles.authButton}
                        onClick={login}
                        disabled={loading} // this simply makes the button unclickable when pressed.
                    >
                        {loading ? `Logging in...` : `Login`}
                    </button>

                    {onTryDemo && (
                        <>
                            <div className={styles.demoDivider}>or</div>
                            <button
                                type="button"
                                className={styles.demoButton}
                                onClick={tryDemo}
                            >
                                ✨ Try it free — no signup
                            </button>
                            <p className={styles.demoHint}>
                                Explore the whole app instantly. Nothing is saved or collected.
                            </p>
                        </>
                    )}

                </div>

                {/* redirect to register page */}
                <div className={styles.authFooter}>
                    <p className={styles.authFooterText}>
                        Don't have an account? <a href="/register" className={styles.authLink}>Register now</a>
                    </p>
                </div>

            </div>
        </div>
    )
}

export default LoginPage
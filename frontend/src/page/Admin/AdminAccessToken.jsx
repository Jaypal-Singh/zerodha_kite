import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { RefreshCw, LogOut, Key, CheckCircle, XCircle, Clock, AlertTriangle, ExternalLink } from 'lucide-react';

const AdminAccessToken = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [tokenStatus, setTokenStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [manualLoginLoading, setManualLoginLoading] = useState(false);
    const [error, setError] = useState(null);

    const apiBase = import.meta.env.VITE_REACT_APP_API_URL || '';

    // Check if user is admin
    useEffect(() => {
        const userStr = localStorage.getItem('loggedInUser');
        if (userStr) {
            const user = JSON.parse(userStr);
            if (user.role !== 'admin') {
                navigate('/');
            }
        } else {
            navigate('/');
        }
    }, [navigate]);

    // Fetch token status
    const fetchTokenStatus = async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(`${apiBase}/api/kite/status`);
            if (!res.ok) {
                throw new Error('Failed to fetch token status');
            }
            const data = await res.json();
            setTokenStatus(data);
        } catch (err) {
            console.error('[AdminAccessToken] Fetch error:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTokenStatus();
    }, []);

    // Trigger auto-login refresh
    const handleRefreshToken = async () => {
        setRefreshing(true);
        setError(null);
        try {
            const res = await fetch(`${apiBase}/api/kite/auto-login/trigger`, {
                method: 'POST',
            });
            const data = await res.json();

            if (data.success) {
                // Refresh status after successful login
                await fetchTokenStatus();
            } else {
                setError(data.error || 'Auto-login failed');
            }
        } catch (err) {
            console.error('[AdminAccessToken] Refresh error:', err);
            setError(err.message);
        } finally {
            setRefreshing(false);
        }
    };

    // Manual Login - opens Kite login in new tab
    const handleManualLogin = async () => {
        setManualLoginLoading(true);
        setError(null);
        try {
            const res = await fetch(`${apiBase}/api/kite/login-url`);
            const data = await res.json();

            if (data.success && data.loginUrl) {
                // Open login URL in new tab
                window.open(data.loginUrl, '_blank');
            } else {
                setError(data.error || 'Failed to get login URL');
            }
        } catch (err) {
            console.error('[AdminAccessToken] Manual login error:', err);
            setError(err.message);
        } finally {
            setManualLoginLoading(false);
        }
    };

    // Handle logout
    const handleLogout = () => {
        localStorage.removeItem('token');
        localStorage.removeItem('authToken');
        localStorage.removeItem('loggedInUser');
        localStorage.removeItem('associatedBrokerStringId');
        localStorage.removeItem('activeContext');
        navigate('/');
    };

    // Format date
    const formatDateTime = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr);
        return date.toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Get status color and icon
    const getStatusDisplay = () => {
        if (!tokenStatus) return { color: 'gray', icon: Clock, text: 'Unknown' };

        if (tokenStatus.is_expired) {
            return { color: 'red', icon: XCircle, text: 'EXPIRED' };
        }

        if (tokenStatus.hours_remaining < 2) {
            return { color: 'yellow', icon: AlertTriangle, text: 'EXPIRING SOON' };
        }

        return { color: 'green', icon: CheckCircle, text: 'VALID' };
    };

    const statusDisplay = getStatusDisplay();
    const StatusIcon = statusDisplay.icon;

    const tabs = [
        { label: 'Registrations', path: '/admin/registrations' },
        { label: 'Access Token', path: '/admin/access-token' },
    ];

    return (
        <div className="min-h-screen bg-[var(--bg-primary)]">
            {/* Header */}
            <div className="sticky top-0 z-40 bg-[var(--bg-secondary)] border-b border-[var(--border-color)] px-4 py-3">
                <div className="flex items-center justify-between mb-3">
                    <h1 className="text-xl font-bold text-[var(--text-primary)]">
                        Admin Panel
                    </h1>
                    <button
                        onClick={handleLogout}
                        className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                    >
                        <LogOut className="w-5 h-5" />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex gap-2">
                    {tabs.map((tab) => (
                        <button
                            key={tab.path}
                            onClick={() => navigate(tab.path)}
                            className={`px-4 py-2 rounded-lg font-semibold text-sm transition ${location.pathname === tab.path
                                ? 'bg-indigo-600 text-white'
                                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Content */}
            <div className="p-4">
                {/* Loading State */}
                {loading && (
                    <div className="flex items-center justify-center py-20">
                        <div className="text-center">
                            <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mx-auto mb-3" />
                            <p className="text-[var(--text-muted)]">Loading token status...</p>
                        </div>
                    </div>
                )}

                {/* Error State */}
                {error && !loading && (
                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
                        <p className="text-red-400 text-sm">{error}</p>
                    </div>
                )}

                {/* Token Status Card */}
                {!loading && tokenStatus && (
                    <div className="space-y-4">
                        {/* Status Card */}
                        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-6">
                            {/* Status Badge */}
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-3">
                                    <div className={`p-3 rounded-full bg-${statusDisplay.color}-500/20`}>
                                        <Key className={`w-6 h-6 text-${statusDisplay.color}-400`} />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-[var(--text-primary)]">Kite Access Token</h2>
                                        <p className="text-sm text-[var(--text-muted)]">User: {tokenStatus.user_id}</p>
                                    </div>
                                </div>
                                <div className={`flex items-center gap-2 px-4 py-2 rounded-full bg-${statusDisplay.color}-500/20 border border-${statusDisplay.color}-500/30`}>
                                    <StatusIcon className={`w-5 h-5 text-${statusDisplay.color}-400`} />
                                    <span className={`font-bold text-${statusDisplay.color}-400`}>{statusDisplay.text}</span>
                                </div>
                            </div>

                            {/* Details Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="bg-[var(--bg-primary)] rounded-lg p-4">
                                    <p className="text-xs text-[var(--text-muted)] mb-1">Hours Remaining</p>
                                    <p className="text-2xl font-bold text-[var(--text-primary)]">
                                        {tokenStatus.hours_remaining?.toFixed(1) || '0'}h
                                    </p>
                                </div>
                                <div className="bg-[var(--bg-primary)] rounded-lg p-4">
                                    <p className="text-xs text-[var(--text-muted)] mb-1">Token Expiry</p>
                                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                                        {formatDateTime(tokenStatus.token_expiry)}
                                    </p>
                                </div>
                                <div className="bg-[var(--bg-primary)] rounded-lg p-4">
                                    <p className="text-xs text-[var(--text-muted)] mb-1">Last Login</p>
                                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                                        {formatDateTime(tokenStatus.login_time)}
                                    </p>
                                </div>
                                <div className="bg-[var(--bg-primary)] rounded-lg p-4">
                                    <p className="text-xs text-[var(--text-muted)] mb-1">Token Preview</p>
                                    <p className="text-sm font-mono text-[var(--text-secondary)]">
                                        {tokenStatus.access_token_preview || 'N/A'}
                                    </p>
                                </div>
                            </div>

                            {/* Message */}
                            {tokenStatus.message && (
                                <p className="mt-4 text-sm text-[var(--text-muted)] text-center">
                                    {tokenStatus.message}
                                </p>
                            )}
                        </div>

                        {/* Actions */}
                        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-[var(--text-primary)]">Auto Refresh Token</h3>
                                    <p className="text-sm text-[var(--text-muted)]">Trigger auto-login (may fail if CAPTCHA required)</p>
                                </div>
                                <button
                                    onClick={handleRefreshToken}
                                    disabled={refreshing}
                                    className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    <RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} />
                                    {refreshing ? 'Refreshing...' : 'Refresh Now'}
                                </button>
                            </div>
                        </div>

                        {/* Manual Login */}
                        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-[var(--text-primary)]">Manual Login</h3>
                                    <p className="text-sm text-[var(--text-muted)]">Opens Kite login in new tab (use if CAPTCHA required)</p>
                                </div>
                                <button
                                    onClick={handleManualLogin}
                                    disabled={manualLoginLoading}
                                    className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-50 flex items-center gap-2"
                                >
                                    <ExternalLink className={`w-5 h-5 ${manualLoginLoading ? 'animate-pulse' : ''}`} />
                                    {manualLoginLoading ? 'Opening...' : 'Login via Kite'}
                                </button>
                            </div>
                        </div>

                        {/* Auto-Login Info */}
                        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border-color)] p-4">
                            <h3 className="font-semibold text-[var(--text-primary)] mb-2">Auto-Login Schedule</h3>
                            <p className="text-sm text-[var(--text-muted)]">
                                Token is automatically refreshed every day at <strong className="text-[var(--text-primary)]">7:55 AM IST</strong> before market opens.
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AdminAccessToken;

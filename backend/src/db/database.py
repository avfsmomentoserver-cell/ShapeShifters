"""
Database connector for crash analytics.
Handles SQLite operations with momento.db schema.
"""

import sqlite3
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from contextlib import contextmanager
import numpy as np


@dataclass
class Round:
    """Represents a single crash round"""
    id: int
    timestamp: float
    multiplier: float
    hash: str
    server_seed: str
    client_seed: str
    nonce: int


@dataclass
class Forecast:
    """Stored forecast prediction"""
    id: int
    round_id: Optional[int]
    timestamp: float
    component_type: str  # 'curve_shape', 'streak', 'dry_zone', 'moonshot', 'eta'
    prediction: Dict
    confidence: float
    actual_outcome: Optional[float] = None
    is_accurate: Optional[bool] = None


@dataclass
class Pattern:
    """Detected pattern in historical data"""
    id: int
    pattern_type: str
    start_round: int
    end_round: int
    parameters: Dict
    strength: float  # 0-1
    created_at: float


class DatabaseConnector:
    """
    SQLite database connector for crash analytics.
    
    Supports:
    - Reading historical rounds
    - Storing forecasts and patterns
    - Computing aggregate statistics
    """
    
    def __init__(self, db_path: str = "momento.db"):
        self.db_path = db_path
        self._init_schema()
    
    @contextmanager
    def get_connection(self):
        """Context manager for database connections"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
    
    def _init_schema(self):
        """Initialize database schema if not exists"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Rounds table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS rounds (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp REAL NOT NULL,
                    multiplier REAL NOT NULL,
                    hash TEXT NOT NULL,
                    server_seed TEXT,
                    client_seed TEXT,
                    nonce INTEGER,
                    UNIQUE(timestamp, hash)
                )
            """)
            
            # Forecasts table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS forecasts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    round_id INTEGER,
                    timestamp REAL NOT NULL,
                    component_type TEXT NOT NULL,
                    prediction TEXT NOT NULL,
                    confidence REAL NOT NULL,
                    actual_outcome REAL,
                    is_accurate BOOLEAN,
                    FOREIGN KEY (round_id) REFERENCES rounds(id)
                )
            """)
            
            # Patterns table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS patterns (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    pattern_type TEXT NOT NULL,
                    start_round INTEGER NOT NULL,
                    end_round INTEGER NOT NULL,
                    parameters TEXT NOT NULL,
                    strength REAL NOT NULL,
                    created_at REAL NOT NULL
                )
            """)
            
            # Create indices for performance
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_rounds_timestamp ON rounds(timestamp)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_rounds_multiplier ON rounds(multiplier)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_forecasts_type ON forecasts(component_type)")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type)")
    
    def insert_round(self, timestamp: float, multiplier: float, hash: str,
                    server_seed: str = "", client_seed: str = "", nonce: int = 0) -> int:
        """Insert a new round and return its ID"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("""
                    INSERT INTO rounds (timestamp, multiplier, hash, server_seed, client_seed, nonce)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (timestamp, multiplier, hash, server_seed, client_seed, nonce))
                return cursor.lastrowid
            except sqlite3.IntegrityError:
                # Round already exists, fetch its ID
                cursor.execute("""
                    SELECT id FROM rounds WHERE timestamp = ? AND hash = ?
                """, (timestamp, hash))
                row = cursor.fetchone()
                return row['id'] if row else -1
    
    def insert_rounds_batch(self, rounds: List[Tuple]) -> int:
        """Insert multiple rounds efficiently"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.executemany("""
                INSERT OR IGNORE INTO rounds (timestamp, multiplier, hash, server_seed, client_seed, nonce)
                VALUES (?, ?, ?, ?, ?, ?)
            """, rounds)
            return cursor.rowcount
    
    def get_all_multipliers(self, limit: Optional[int] = None) -> np.ndarray:
        """Get all multipliers as numpy array"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            query = "SELECT multiplier FROM rounds ORDER BY timestamp DESC"
            if limit:
                query += f" LIMIT {limit}"
            cursor.execute(query)
            rows = cursor.fetchall()
            return np.array([row['multiplier'] for row in rows])
    
    def get_recent_rounds(self, count: int = 100) -> List[Round]:
        """Get most recent rounds"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, timestamp, multiplier, hash, server_seed, client_seed, nonce
                FROM rounds
                ORDER BY timestamp DESC
                LIMIT ?
            """, (count,))
            rows = cursor.fetchall()
            return [Round(**dict(row)) for row in rows]
    
    def get_rounds_since(self, timestamp: float) -> List[Round]:
        """Get rounds since a specific timestamp"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, timestamp, multiplier, hash, server_seed, client_seed, nonce
                FROM rounds
                WHERE timestamp > ?
                ORDER BY timestamp ASC
            """, (timestamp,))
            rows = cursor.fetchall()
            return [Round(**dict(row)) for row in rows]
    
    def save_forecast(self, round_id: Optional[int], component_type: str,
                     prediction: Dict, confidence: float) -> int:
        """Save a forecast prediction"""
        import json
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO forecasts (round_id, timestamp, component_type, prediction, confidence)
                VALUES (?, ?, ?, ?, ?)
            """, (round_id, timestamp := __import__('time').time(), 
                  component_type, json.dumps(prediction), confidence))
            return cursor.lastrowid
    
    def update_forecast_outcome(self, forecast_id: int, actual_outcome: float):
        """Update forecast with actual outcome"""
        is_accurate = self._evaluate_forecast_accuracy(forecast_id, actual_outcome)
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE forecasts
                SET actual_outcome = ?, is_accurate = ?
                WHERE id = ?
            """, (actual_outcome, is_accurate, forecast_id))
    
    def _evaluate_forecast_accuracy(self, forecast_id: int, actual: float) -> bool:
        """Evaluate if a forecast was accurate based on stored prediction"""
        import json
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT component_type, prediction FROM forecasts WHERE id = ?
            """, (forecast_id,))
            row = cursor.fetchone()
            
            if not row:
                return False
            
            component_type = row['component_type']
            prediction = json.loads(row['prediction'])
            
            # Simple accuracy evaluation logic
            if component_type == 'eta':
                estimated = prediction.get('estimated_crash_point', 0)
                return abs(estimated - actual) / actual < 0.3  # Within 30%
            elif component_type == 'moonshot':
                prob_moonshot = prediction.get('probability_moonshot', 0)
                is_moonshot = actual >= 5.0
                return (prob_moonshot > 0.5 and is_moonshot) or (prob_moonshot <= 0.5 and not is_moonshot)
            elif component_type == 'dry_zone':
                prob_dry = prediction.get('probability_low_zone', 0)
                is_dry = actual < 2.0
                return (prob_dry > 0.5 and is_dry) or (prob_dry <= 0.5 and not is_dry)
            else:
                return True  # Default to accurate for other types
    
    def save_pattern(self, pattern_type: str, start_round: int, end_round: int,
                    parameters: Dict, strength: float) -> int:
        """Save a detected pattern"""
        import json
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO patterns (pattern_type, start_round, end_round, parameters, strength, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (pattern_type, start_round, end_round, json.dumps(parameters), 
                  strength, __import__('time').time()))
            return cursor.lastrowid
    
    def get_patterns_by_type(self, pattern_type: str, limit: int = 10) -> List[Pattern]:
        """Get patterns of a specific type"""
        import json
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT id, pattern_type, start_round, end_round, parameters, strength, created_at
                FROM patterns
                WHERE pattern_type = ?
                ORDER BY created_at DESC
                LIMIT ?
            """, (pattern_type, limit))
            rows = cursor.fetchall()
            patterns = []
            for row in rows:
                row_dict = dict(row)
                row_dict['parameters'] = json.loads(row_dict['parameters'])
                patterns.append(Pattern(**row_dict))
            return patterns
    
    def get_statistics(self) -> Dict:
        """Get aggregate statistics from database"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            stats = {}
            
            # Basic counts
            cursor.execute("SELECT COUNT(*) as count FROM rounds")
            stats['total_rounds'] = cursor.fetchone()['count']
            
            cursor.execute("SELECT COUNT(*) as count FROM forecasts")
            stats['total_forecasts'] = cursor.fetchone()['count']
            
            cursor.execute("SELECT COUNT(*) as count FROM patterns")
            stats['total_patterns'] = cursor.fetchone()['count']
            
            # Multiplier statistics
            cursor.execute("""
                SELECT AVG(multiplier) as avg, MIN(multiplier) as min, 
                       MAX(multiplier) as max, SUM(multiplier) as sum
                FROM rounds
            """)
            row = cursor.fetchone()
            stats['multiplier_stats'] = {
                'mean': row['avg'],
                'min': row['min'],
                'max': row['max'],
                'sum': row['sum']
            }
            
            # Forecast accuracy
            cursor.execute("""
                SELECT COUNT(*) as total, SUM(CASE WHEN is_accurate THEN 1 ELSE 0 END) as accurate
                FROM forecasts
                WHERE is_accurate IS NOT NULL
            """)
            row = cursor.fetchone()
            if row['total'] > 0:
                stats['forecast_accuracy'] = row['accurate'] / row['total']
            else:
                stats['forecast_accuracy'] = None
            
            return stats
    
    def clear_old_data(self, days_to_keep: int = 30):
        """Remove data older than specified days"""
        import time
        
        cutoff_timestamp = time.time() - (days_to_keep * 24 * 60 * 60)
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # Delete old rounds (cascade will handle related forecasts)
            cursor.execute("""
                DELETE FROM rounds WHERE timestamp < ?
            """, (cutoff_timestamp,))
            
            deleted_rounds = cursor.rowcount
            
            # Delete old patterns
            cursor.execute("""
                DELETE FROM patterns WHERE created_at < ?
            """, (cutoff_timestamp,))
            
            deleted_patterns = cursor.rowcount
            
            return {'deleted_rounds': deleted_rounds, 'deleted_patterns': deleted_patterns}
    
    def export_to_csv(self, table_name: str, output_path: str):
        """Export a table to CSV file"""
        import csv
        
        if table_name not in ['rounds', 'forecasts', 'patterns']:
            raise ValueError(f"Invalid table name: {table_name}")
        
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"SELECT * FROM {table_name}")
            rows = cursor.fetchall()
            
            if not rows:
                return
            
            with open(output_path, 'w', newline='') as f:
                writer = csv.writer(f)
                # Write header
                writer.writerow([description[0] for description in cursor.description])
                # Write data
                for row in rows:
                    writer.writerow(list(row))

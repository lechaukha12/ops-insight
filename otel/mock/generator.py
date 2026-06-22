import time
import random
import traceback
import logging
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry._logs import set_logger_provider
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter

# 10 Simulated microservices
SERVICES = [
    "gateway-service",
    "auth-service",
    "user-service",
    "payment-service",
    "notification-service",
    "sms-service",
    "order-service",
    "inventory-service",
    "shipping-service",
    "report-service"
]

print("Initializing OpenTelemetry providers for 10 virtual services...")

tracers = {}
loggers = {}
trace_processors = []
log_processors = []

# Disable duplicate log outputs to console from root logger
logging.getLogger().handlers = []

for svc in SERVICES:
    resource = Resource(attributes={"service.name": svc, "environment": "mock-test"})
    
    # 1. Trace Setup
    tp = TracerProvider(resource=resource)
    trace_exporter = OTLPSpanExporter(endpoint="otel-collector:4317", insecure=True)
    span_processor = BatchSpanProcessor(trace_exporter)
    tp.add_span_processor(span_processor)
    trace_processors.append(span_processor)
    tracers[svc] = tp.get_tracer(svc)
    
    # 2. Log Setup
    lp = LoggerProvider(resource=resource)
    set_logger_provider(lp)
    log_exporter = OTLPLogExporter(endpoint="otel-collector:4317", insecure=True)
    log_processor = BatchLogRecordProcessor(log_exporter)
    lp.add_log_record_processor(log_processor)
    log_processors.append(log_processor)
    
    # Setup native Python Logger for the service
    handler = LoggingHandler(level=logging.INFO, logger_provider=lp)
    logger = logging.getLogger(svc)
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    
    # Also log to standard stdout console for container troubleshooting
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(logging.Formatter(f'[{svc}] %(levelname)s: %(message)s'))
    logger.addHandler(console_handler)
    
    loggers[svc] = logger

# Scenario 1: Successful login flow
def run_login_success():
    print("Running Scenario: Login Success")
    with tracers["gateway-service"].start_as_current_span("GET /login") as g_span:
        loggers["gateway-service"].info("Received login request from IP 192.168.1.50")
        time.sleep(random.uniform(0.005, 0.015))
        
        with tracers["auth-service"].start_as_current_span("AuthenticateUser") as a_span:
            loggers["auth-service"].info("Verifying user password hash...")
            time.sleep(random.uniform(0.015, 0.030))
            
            with tracers["user-service"].start_as_current_span("GetUserProfile") as u_span:
                loggers["user-service"].info("Fetching user profile metadata from PostgreSQL database")
                time.sleep(random.uniform(0.010, 0.025))
                u_span.set_attribute("user.id", "99482")
                u_span.set_attribute("db.system", "postgresql")
                
            a_span.set_attribute("auth.status", "success")
            loggers["auth-service"].info("JWT Token generated successfully for user 99482")
            
        g_span.set_attribute("http.status_code", 200)
        loggers["gateway-service"].info("User logged in successfully. Status code 200 returned.")

# Scenario 2: Failed login flow
def run_login_failed():
    print("Running Scenario: Login Failed")
    with tracers["gateway-service"].start_as_current_span("GET /login") as g_span:
        loggers["gateway-service"].info("Received login request from IP 203.0.113.12")
        time.sleep(random.uniform(0.005, 0.010))
        
        with tracers["auth-service"].start_as_current_span("AuthenticateUser") as a_span:
            loggers["auth-service"].info("Verifying user password hash...")
            time.sleep(random.uniform(0.010, 0.020))
            
            err_msg = "Invalid username or password credentials"
            a_span.set_status(Status(StatusCode.ERROR, err_msg))
            try:
                raise ValueError(err_msg)
            except Exception as e:
                a_span.record_exception(e)
                loggers["auth-service"].error(f"Authentication failed: {err_msg}")
            
        g_span.set_attribute("http.status_code", 401)
        loggers["gateway-service"].warning("Authentication failed. Status code 401 returned.")

# Scenario 3: Order placement with high latency (slow payment gateway)
def run_order_placement_slow():
    print("Running Scenario: Order Placement Slow")
    with tracers["gateway-service"].start_as_current_span("POST /order") as g_span:
        loggers["gateway-service"].info("Initiating checkout flow...")
        time.sleep(random.uniform(0.010, 0.020))
        
        with tracers["order-service"].start_as_current_span("ProcessOrder") as o_span:
            loggers["order-service"].info("Creating pending order record in MongoDB")
            time.sleep(random.uniform(0.020, 0.040))
            
            with tracers["inventory-service"].start_as_current_span("CheckAndReserveStock") as i_span:
                loggers["inventory-service"].info("Checking warehouse stock availability for SKUs")
                time.sleep(random.uniform(0.015, 0.035))
                loggers["inventory-service"].info("Items reserved successfully")
            
            # Simulated high latency payment processing
            with tracers["payment-service"].start_as_current_span("ProcessPaymentExternal") as p_span:
                loggers["payment-service"].warning("Sending payment request to Stripe API gateway...")
                # Sleep a significant amount to simulate a slow span
                time.sleep(random.uniform(1.500, 2.800))
                loggers["payment-service"].info("Stripe charge transaction approved")
                p_span.set_attribute("payment.provider", "stripe")
                p_span.set_attribute("payment.amount", 129.99)
            
            with tracers["notification-service"].start_as_current_span("SendOrderReceipt") as n_span:
                loggers["notification-service"].info("Queueing invoice email notification")
                
                with tracers["sms-service"].start_as_current_span("SendSMSAlert") as s_span:
                    loggers["sms-service"].info("Sending SMS confirmation dispatch to Twilio API")
                    time.sleep(random.uniform(0.100, 0.200))
            
        g_span.set_attribute("http.status_code", 201)
        loggers["gateway-service"].info("Checkout completed. Order created successfully.")

# Scenario 4: Error during report generation (deadlock & downstream timeout)
def run_report_generation_error():
    print("Running Scenario: Report Generation Error")
    with tracers["gateway-service"].start_as_current_span("GET /reports/generate") as g_span:
        loggers["gateway-service"].info("Received request for financial report compilation")
        time.sleep(random.uniform(0.005, 0.012))
        
        with tracers["report-service"].start_as_current_span("CompileFinancialReport") as r_span:
            loggers["report-service"].info("Aggregating transactional records...")
            time.sleep(random.uniform(0.050, 0.100))
            
            with tracers["inventory-service"].start_as_current_span("ScanHistoricalInventoryLogs") as i_span:
                loggers["inventory-service"].info("Scanning historical inventory log rows...")
                time.sleep(random.uniform(0.300, 0.600))
                
                err_msg = "Database deadlock detected during historical scan"
                i_span.set_status(Status(StatusCode.ERROR, err_msg))
                try:
                    raise RuntimeError(err_msg)
                except Exception as e:
                    i_span.record_exception(e)
                    loggers["inventory-service"].error(f"Execution failed: {traceback.format_exc()}")
                    
            err_msg_ds = "Report compiler failed due to downstream inventory service deadlock timeout"
            r_span.set_status(Status(StatusCode.ERROR, err_msg_ds))
            try:
                raise RuntimeError(err_msg_ds)
            except Exception as e:
                r_span.record_exception(e)
                loggers["report-service"].error(err_msg_ds)
            
        g_span.set_status(Status(StatusCode.ERROR, "Internal Server Error"))
        g_span.set_attribute("http.status_code", 500)
        loggers["gateway-service"].error("HTTP Response 500 returned to user: Downstream service failure")

try:
    scenario_functions = [
        run_login_success,
        run_login_failed,
        run_order_placement_slow,
        run_report_generation_error
    ]
    
    trace_count = 0
    print("Starting trace dispatch loop...")
    while True:
        # Pick a random scenario to run
        scenario = random.choice(scenario_functions)
        scenario()
        trace_count += 1
        
        if trace_count % 10 == 0:
            print(f"Dispatched {trace_count} trace chains to the OTel Collector.")
            
        # Flush buffers to send traces/logs promptly
        for tp in trace_processors:
            tp.force_flush()
        for lp in log_processors:
            lp.force_flush()
            
        # Wait between requests
        time.sleep(random.uniform(1.0, 5.0))
        
except KeyboardInterrupt:
    print("Shutting down telemetry mock generator.")

using Microsoft.AspNetCore.Cors.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

// Add this before app.UseRouting() or other middleware
builder.Services.AddCors(options =>
{
 options.AddPolicy("CorsPolicy", builder =>
 {
  builder
         .WithOrigins("http://localhost:5173", "http://localhost:3000") // Add your frontend URL(s)
         .AllowAnyMethod()
         .AllowAnyHeader()
         .AllowCredentials(); // This is needed for SignalR
 });
});

// ... existing code ...

builder.Services.AddSignalR(options =>
{
 // Other SignalR options if any
}).AddJsonProtocol();

var app = builder.Build();

// Add this before app.UseAuthorization() but after UseRouting()
app.UseCors("CorsPolicy");

// ... existing code ...

app.Run();
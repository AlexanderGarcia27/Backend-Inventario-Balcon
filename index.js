const express = require("express");
const cors = require("cors");
const { db } = require("./firebase");

const app = express();
app.use(cors());
app.use(express.json());

// ----------------------
// GENERAR CODIGO VENTA
// ----------------------
async function generarCodigoVenta() {
  const ventas = await db.collection("ventas").get();
  const total = ventas.size + 1;
  return "V" + String(total).padStart(3, "0");
}

// ----------------------------------------------
// CRUD PRODUCTOS (SIN CAMBIOS)
// ----------------------------------------------

// Crear producto(s) - Acepta un objeto simple O un array de objetos
app.post("/productos", async (req, res) => {
  try {
    const productosParaGuardar = Array.isArray(req.body) ? req.body : [req.body];
    const snapshot = await db.collection("productos").get();
    let ultimoNumero = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.codigo) {
        const num = parseInt(data.codigo.replace("P", ""));
        if (num > ultimoNumero) ultimoNumero = num;
      }
    });

    const productosAgregados = [];
    let productosOmitidos = 0;

    for (const producto of productosParaGuardar) {
      if (!producto || !producto.nombre) {
        productosOmitidos++;
        continue;
      }

      ultimoNumero++;
      const nuevoCodigo = "P" + ultimoNumero.toString().padStart(3, "0");

      const nuevoProducto = {
        nombre: producto.nombre,
        precio: Number(producto.precio) || 0,
        precioCompra: Number(producto.precioCompra) || 0,
        categoria: producto.categoria || 'Sin Categoría',
        stock: Number(producto.stock) || 0,
        codigo: nuevoCodigo,
        creadoEn: new Date()
      };

      const productoRef = await db.collection("productos").add(nuevoProducto);

      productosAgregados.push({
        id: productoRef.id,
        nombre: nuevoProducto.nombre,
        codigo: nuevoCodigo
      });
    }

    if (productosAgregados.length === 0) {
      return res.status(400).json({ error: "No se encontró ningún producto válido para agregar." });
    }

    res.json({
      mensaje: "Productos agregados correctamente.",
      total_agregados: productosAgregados.length,
      total_omitidos: productosOmitidos,
      productos: productosAgregados
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al agregar productos" });
  }
});

// Listar productos
app.get("/productos", async (req, res) => {
  try {
    const snapshot = await db.collection("productos").get();
    const lista = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    lista.sort((a, b) => {
      const numA = parseInt(a.codigo.replace("P", ""));
      const numB = parseInt(b.codigo.replace("P", ""));
      return numA - numB;
    });

    res.json(lista);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Actualizar producto
app.put("/productos/:id", async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (updateData.precio !== undefined) {
      updateData.precio = Number(updateData.precio) || 0;
    }
    if (updateData.stock !== undefined) {
      updateData.stock = Number(updateData.stock) || 0;
    }
    if (updateData.precioCompra !== undefined) {
      updateData.precioCompra = Number(updateData.precioCompra) || 0;
    }

    await db.collection("productos").doc(req.params.id).update(updateData);
    res.json({ mensaje: "Producto actualizado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Eliminar producto
app.delete("/productos/:id", async (req, res) => {
  try {
    await db.collection("productos").doc(req.params.id).delete();
    res.json({ mensaje: "Producto eliminado" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ----------------------------------------------
// GESTIÓN DE DATOS PELIGROSA (BORRADO TOTAL) (SIN CAMBIOS)
// ----------------------------------------------

async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  return snapshot.size;
}

app.delete("/administracion/borrar-todo-peligro", async (req, res) => {
  try {
    console.log("INICIANDO BORRADO TOTAL DE DATOS...");
    const productosBorrados = await deleteCollection("productos");
    const ventasBoradas = await deleteCollection("ventas");
    console.log("BORRADO TOTAL FINALIZADO.");

    res.json({
      mensaje: "PELIGRO! Todas las colecciones han sido vaciadas.",
      detalle: {
        productos_eliminados: productosBorrados,
        ventas_eliminadas: ventasBoradas,
      },
    });
  } catch (error) {
    console.error("Error en el borrado total:", error);
    res.status(500).json({ error: "Error fatal al intentar borrar colecciones" });
  }
});

// ----------------------------------------------
// VENTAS (ADAPTADAS PARA CARRITO)
// ----------------------------------------------

// Crear una venta (Soporta MÚLTIPLES ARTÍCULOS)
app.post("/ventas", async (req, res) => {
  try {
    // CAMBIO CLAVE: Esperar 'articulos' como un array de objetos
    const { articulos, total, monto, cambio, nota } = req.body;

    if (!articulos || !Array.isArray(articulos) || articulos.length === 0 || !total || !monto) {
      return res.status(400).json({ error: "Faltan datos obligatorios o la lista de artículos está vacía." });
    }

    let costoVentaTotal = 0;
    const batch = db.batch();
    const articulosVentaFinal = []; // Para guardar en la venta principal

    // 1. Validar y procesar cada artículo en el carrito
    for (const item of articulos) {
      const { productoId, cantidad, precioVenta } = item;

      const qty = Number(cantidad);
      const salePrice = Number(precioVenta);

      if (!productoId || qty <= 0 || salePrice <= 0) {
        // Si un artículo es inválido, abortamos toda la transacción
        return res.status(400).json({ error: "Datos de artículo inválidos (productoId, cantidad o precioVenta)" });
      }

      const productoRef = db.collection("productos").doc(productoId);
      const productoDoc = await productoRef.get();

      if (!productoDoc.exists) {
        return res.status(404).json({ error: `Producto no encontrado con ID: ${productoId}` });
      }

      const producto = productoDoc.data();

      // Validar stock
      if (producto.stock < qty) {
        return res.status(400).json({ error: `Stock insuficiente para el producto ${producto.nombre}. Disponible: ${producto.stock}, Solicitado: ${qty}` });
      }

      // Cálculo de Costo y Ganancia (a nivel de artículo)
      const precioCompraUnidad = producto.precioCompra || 0;
      const costoMercanciaVendidaArticulo = precioCompraUnidad * qty;
      costoVentaTotal += costoMercanciaVendidaArticulo;

      // Preparar descuento de stock en el batch
      batch.update(productoRef, {
        stock: producto.stock - qty
      });

      // Agregar al array final, incluyendo datos para la BD
      articulosVentaFinal.push({
        productoId: productoId,
        cantidad: qty,
        precioVenta: salePrice,
        subtotal: qty * salePrice,
        costoUnitario: precioCompraUnidad, // Para referencia
      });
    }

    // 2. Ejecutar todas las actualizaciones de stock
    await batch.commit();

    // 3. Generar código de venta V00X
    const codigoVenta = await generarCodigoVenta();

    // 4. Calcular la ganancia total
    const gananciaTotal = Number(total) - costoVentaTotal;

    // 5. Crear objeto de venta principal
    const ventaData = {
      codigo: codigoVenta,
      articulos: articulosVentaFinal, // CRUCIAL: Lista de artículos
      total: Number(total),
      monto: Number(monto),
      cambio: Number(cambio),
      costoVenta: costoVentaTotal, // CRUCIAL: Costo total de todos los artículos
      ganancia: gananciaTotal,
      nota: nota || "",
      fecha: new Date()
    };

    // 6. Guardar venta
    const ventaRef = await db.collection("ventas").add(ventaData);

    res.json({
      mensaje: "Venta registrada correctamente (Multi-artículo)",
      id: ventaRef.id,
      venta: ventaData
    });

  } catch (error) {
    console.error("Error al registrar venta multi-artículo:", error);
    res.status(500).json({ error: error.message || "Error desconocido al registrar la venta" });
  }
});

// Obtener todas las ventas con datos del producto (Optimizado y calcula Ganancia - Ahora resumido)
app.get("/ventas", async (req, res) => {
  try {
    const ventasSnapshot = await db.collection("ventas").get();
    const productosSnapshot = await db.collection("productos").get();
    const productosMap = {};
    productosSnapshot.docs.forEach(doc => {
      productosMap[doc.id] = doc.data();
    });

    const ventas = [];

    for (const doc of ventasSnapshot.docs) {
      const venta = doc.data();
      venta.id = doc.id;

      // Calcular la ganancia (ya debería estar calculada, pero se reafirma)
      const costoVenta = venta.costoVenta || 0;
      venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

      // --- ADAPTACIÓN PARA VENTA MULTI-PRODUCTO (RESUMEN) ---
      const articulos = venta.articulos || [];

      if (articulos.length > 0) {
        const primerArticulo = articulos[0];
        const producto = productosMap[primerArticulo.productoId];
        const numArticulos = articulos.length;

        if (producto) {
          // Resumen para la tabla principal
          venta.productoNombre = numArticulos > 1 ? `${producto.nombre} (+${numArticulos - 1} más)` : producto.nombre;
          venta.productoCodigo = producto.codigo;
          venta.cantidad = `${numArticulos} artículos`; // Mostrar el número de artículos
        } else {
          venta.productoNombre = `Venta con ${numArticulos} artículos (Detalles no disponibles)`;
          venta.productoCodigo = "-";
          venta.cantidad = `${numArticulos} artículos`;
        }
      } else {
        // Manejo de ventas unitarias antiguas o errores (Legacy Support)
        const productoId = venta.productoId;
        const producto = productoId ? productosMap[productoId] : null;

        venta.productoNombre = producto ? producto.nombre : "Venta sin detalles";
        venta.productoCodigo = producto ? producto.codigo : "-";
        venta.cantidad = venta.cantidad || 1;
      }
      // --------------------------------------------------

      ventas.push(venta);
    }

    res.json(ventas);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una venta específica (No necesita muchos cambios, ya tiene el array de artículos si existe)
app.get("/ventas/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const ventaSnapshot = await db.collection("ventas").doc(id).get();

    if (!ventaSnapshot.exists) {
      return res.status(404).json({ error: "Venta no encontrada" });
    }

    const venta = ventaSnapshot.data();

    // Calcular la ganancia (ya debería estar en el objeto, pero se recalcula/reafirma)
    const costoVenta = venta.costoVenta || 0;
    venta.ganancia = parseFloat((venta.total - costoVenta).toFixed(2));

    return res.json(venta);
  } catch (error) {
    console.error("Error al obtener la venta:", error);
    return res.status(500).json({ error: "Error al obtener la venta" });
  }
});


// ----------------------
const PORT = 3000;
app.listen(PORT, () => console.log("API lista en puerto", PORT));

// ------------------------------
// LOGIN y DASHBOARD (SIN CAMBIOS)
// ------------------------------

app.post('/login', async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Faltan credenciales" });
    }

    const ref = db.collection('usuarios');
    const query = await ref.where("usuario", "==", usuario).get();

    if (query.empty) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const userDoc = query.docs[0].data();

    if (userDoc.password !== password) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    return res.json({ mensaje: "Inicio de sesión exitoso" });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/dashboard/totales", async (req, res) => {
  try {
    const productosSnapshot = await db.collection("productos").get();
    const totalProductos = productosSnapshot.size;

    const productosStockBajo = productosSnapshot.docs.filter(
      doc => doc.data().stock < 10
    ).length;

    const hoy = new Date();
    const hace7dias = new Date();
    hace7dias.setDate(hoy.getDate() - 7);

    const ventasSnapshot = await db.collection("ventas").get();

    let ventasUltimos7Dias = 0;

    ventasSnapshot.forEach(doc => {
      const venta = doc.data();
      const fechaVenta = new Date(venta.fecha.toDate());

      if (fechaVenta >= hace7dias) {
        ventasUltimos7Dias += venta.total;
      }
    });

    res.json({
      totalProductos,
      productosStockBajo,
      ventasUltimos7Dias
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});